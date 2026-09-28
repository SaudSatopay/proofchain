import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError, badRequest, errorHandler, forbidden, unauthorized } from '../src/errors.js';

function mockRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('errorHandler', () => {
  it('formats AppError with its code and status', () => {
    const res = mockRes();
    errorHandler(badRequest('bad input', { field: 'x' }), {} as never, res as never, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'bad input', details: { field: 'x' } },
    });
  });

  it('formats zod validation errors as 400 with issue paths', () => {
    const res = mockRes();
    const schema = z.object({ chainId: z.number().int().positive() });
    const result = schema.safeParse({ chainId: -1 });
    errorHandler(result.error, {} as never, res as never, vi.fn());
    expect(res.statusCode).toBe(400);
    const body = res.body as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0].path).toBe('chainId');
  });

  it('maps auth errors to 401/403', () => {
    const res401 = mockRes();
    errorHandler(unauthorized(), {} as never, res401 as never, vi.fn());
    expect(res401.statusCode).toBe(401);

    const res403 = mockRes();
    errorHandler(forbidden(), {} as never, res403 as never, vi.fn());
    expect(res403.statusCode).toBe(403);
  });

  it('maps multer size errors to 413 and unknown errors to 500', () => {
    const res413 = mockRes();
    errorHandler({ code: 'LIMIT_FILE_SIZE' }, {} as never, res413 as never, vi.fn());
    expect(res413.statusCode).toBe(413);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res500 = mockRes();
    errorHandler(new Error('boom'), {} as never, res500 as never, vi.fn());
    expect(res500.statusCode).toBe(500);
    spy.mockRestore();
  });

  it('AppError carries status through custom instances', () => {
    const err = new AppError(503, 'CHAIN_UNAVAILABLE', 'node down');
    expect(err.status).toBe(503);
    expect(err.code).toBe('CHAIN_UNAVAILABLE');
  });
});
