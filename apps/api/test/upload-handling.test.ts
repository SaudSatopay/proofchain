import { describe, expect, it } from 'vitest';
import { filesFromRequest } from '../src/routes/artifacts.js';

const file = (originalname: string, content: string) =>
  ({ originalname, buffer: Buffer.from(content) }) as Express.Multer.File;

describe('filesFromRequest', () => {
  it('uses originalname when no paths field is supplied', () => {
    const files = filesFromRequest({ files: [file('model.onnx', 'w')], body: {} });
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('model.onnx');
    expect(files[0].bytes).toEqual(new Uint8Array([119]));
  });

  it('applies the aligned paths field for directory uploads', () => {
    const files = filesFromRequest({
      files: [file('a.jpg', '1'), file('labels.csv', '2')],
      body: { paths: JSON.stringify(['images/a.jpg', 'labels.csv']) },
    });
    expect(files.map((f) => f.path)).toEqual(['images/a.jpg', 'labels.csv']);
  });

  it('ignores a paths field whose length does not match', () => {
    const files = filesFromRequest({
      files: [file('a.jpg', '1'), file('b.jpg', '2')],
      body: { paths: JSON.stringify(['only-one']) },
    });
    expect(files.map((f) => f.path)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('rejects requests without files', () => {
    expect(() => filesFromRequest({ files: [], body: {} })).toThrow(/No files uploaded/);
    expect(() => filesFromRequest({ body: {} })).toThrow(/No files uploaded/);
  });

  it('rejects malformed paths JSON', () => {
    expect(() =>
      filesFromRequest({ files: [file('a', '1')], body: { paths: '{not-json' } })
    ).toThrow(/JSON array/);
  });
});
