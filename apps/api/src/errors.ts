import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** Application error with a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Insufficient permissions for this operation') =>
  new AppError(403, 'FORBIDDEN', message);

/** Translate blockchain/service failures into human-readable API errors. */
export function chainUnavailable(err: unknown): AppError {
  const detail = err instanceof Error ? err.message : String(err);
  return new AppError(
    503,
    'CHAIN_UNAVAILABLE',
    'The blockchain node is unreachable. Start the local Hardhat node (`npm run chain`) and deploy the contracts (`npm run deploy`).',
    detail.slice(0, 300)
  );
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  // Multer size/limits errors carry a `code` string.
  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: { code: 'FILE_TOO_LARGE', message: 'Uploaded file exceeds the configured size limit.' },
    });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Unexpected server error' },
  });
}
