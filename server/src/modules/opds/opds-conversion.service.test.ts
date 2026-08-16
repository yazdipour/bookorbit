vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    randomUUID: vi.fn(() => 'conversion-id'),
  };
});

vi.mock('fs', () => ({
  createReadStream: vi.fn(() => ({ kind: 'stream' })),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

import { execFile } from 'child_process';
import { createReadStream } from 'fs';
import { mkdir, rename, rm, stat } from 'fs/promises';
import { ServiceUnavailableException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';

import { OpdsConversionService } from './opds-conversion.service';

const mockExecFile = execFile as MockedFunction<typeof execFile>;
const mockCreateReadStream = createReadStream as MockedFunction<typeof createReadStream>;
const mockMkdir = mkdir as MockedFunction<typeof mkdir>;
const mockRename = rename as MockedFunction<typeof rename>;
const mockRm = rm as MockedFunction<typeof rm>;
const mockStat = stat as MockedFunction<typeof stat>;

function makeService() {
  return new OpdsConversionService({ get: vi.fn().mockReturnValue('/data') } as never);
}

function makeReply() {
  const reply = {
    header: vi.fn(),
    type: vi.fn(),
    send: vi.fn(),
  };
  reply.header.mockReturnValue(reply);
  reply.type.mockReturnValue(reply);
  return reply as never;
}

describe('OpdsConversionService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.PDF_TO_EPUB_CONVERSION_TIMEOUT_MS;
    delete process.env.PDF_TO_EPUB_CONVERTER_PATH;
    mockMkdir.mockResolvedValue(undefined as never);
    mockRename.mockResolvedValue(undefined as never);
    mockRm.mockResolvedValue(undefined as never);
  });

  it('converts to a unique temp file and atomically renames into cache', async () => {
    const service = makeService();
    const reply = makeReply();
    mockStat.mockRejectedValueOnce(new Error('cache miss')).mockResolvedValueOnce({ size: 456 } as never);
    mockExecFile.mockImplementation((_file, _args, _options, callback) => {
      callback?.(null, '', '');
      return {} as never;
    });

    await service.streamPdfAsEpub('/books/book.pdf', 33, 123, 9876, 'Book', reply);

    expect(mockMkdir).toHaveBeenCalledWith('/data/.opds-conversion-cache/33', { recursive: true });
    expect(mockExecFile).toHaveBeenCalledWith(
      'ebook-convert',
      ['/books/book.pdf', '/data/.opds-conversion-cache/33/.conversion-id.tmp.epub'],
      { timeout: 300_000 },
      expect.any(Function),
    );
    expect(mockRename).toHaveBeenCalledWith(
      '/data/.opds-conversion-cache/33/.conversion-id.tmp.epub',
      '/data/.opds-conversion-cache/33/123-9876.epub',
    );
    expect(reply.header).toHaveBeenCalledWith('Content-Length', 456);
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(reply.send).toHaveBeenCalledWith({ kind: 'stream' });
    expect(mockCreateReadStream).toHaveBeenCalledWith('/data/.opds-conversion-cache/33/123-9876.epub');
  });

  it('removes temp output and returns 503 when conversion fails', async () => {
    const service = makeService();
    mockStat.mockRejectedValueOnce(new Error('cache miss'));
    mockExecFile.mockImplementation((_file, _args, _options, callback) => {
      callback?.(new Error('converter failed'), '', '');
      return {} as never;
    });

    await expect(service.streamPdfAsEpub('/books/book.pdf', 33, 123, 9876, 'Book', makeReply())).rejects.toThrow(ServiceUnavailableException);

    expect(mockRm).toHaveBeenCalledWith('/data/.opds-conversion-cache/33/.conversion-id.tmp.epub', { force: true });
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('uses configured converter path and timeout', async () => {
    process.env.PDF_TO_EPUB_CONVERTER_PATH = '/bin/custom-convert';
    process.env.PDF_TO_EPUB_CONVERSION_TIMEOUT_MS = '1200';
    const service = makeService();
    mockStat.mockRejectedValueOnce(new Error('cache miss')).mockResolvedValueOnce({ size: 456 } as never);
    mockExecFile.mockImplementation((_file, _args, _options, callback) => {
      callback?.(null, '', '');
      return {} as never;
    });

    await service.streamPdfAsEpub('/books/book.pdf', 33, 123, 9876.9, 'Book', makeReply());

    expect(mockExecFile).toHaveBeenCalledWith(
      '/bin/custom-convert',
      ['/books/book.pdf', '/data/.opds-conversion-cache/33/.conversion-id.tmp.epub'],
      { timeout: 1200 },
      expect.any(Function),
    );
  });
});
