import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, rename, rm, stat } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';

const execFileAsync = promisify(execFile);
const DEFAULT_CONVERSION_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class OpdsConversionService {
  private readonly logger = new Logger(OpdsConversionService.name);
  private readonly cachePath: string;
  private readonly converterPath = process.env.PDF_TO_EPUB_CONVERTER_PATH ?? 'ebook-convert';
  private readonly conversionTimeoutMs = this.parseConversionTimeout(process.env.PDF_TO_EPUB_CONVERSION_TIMEOUT_MS);

  constructor(config: ConfigService) {
    const appDataPath = config.get<string>('storage.appDataPath')!;
    this.cachePath = join(appDataPath, '.opds-conversion-cache');
  }

  async streamPdfAsEpub(sourcePath: string, fileId: number, sourceSize: number, sourceMtimeMs: number, filenameBase: string, reply: FastifyReply) {
    const cacheDir = join(this.cachePath, String(fileId));
    const cachedPath = join(cacheDir, `${sourceSize}-${Math.floor(sourceMtimeMs)}.epub`);

    try {
      await stat(cachedPath);
    } catch {
      await this.convertPdf(sourcePath, cachedPath, cacheDir);
    }

    const { size } = await stat(cachedPath);
    reply.header('Content-Disposition', `attachment; filename="${filenameBase}.epub"`);
    reply.header('Content-Length', size);
    reply.type('application/epub+zip');
    reply.send(createReadStream(cachedPath));
  }

  private async convertPdf(sourcePath: string, cachedPath: string, cacheDir: string): Promise<void> {
    const tempPath = join(cacheDir, `.${randomUUID()}.tmp.epub`);

    try {
      await mkdir(cacheDir, { recursive: true });
      await execFileAsync(this.converterPath, [sourcePath, tempPath], { timeout: this.conversionTimeoutMs });
      await rename(tempPath, cachedPath);
    } catch (err) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      this.logger.warn(`PDF to EPUB conversion failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('PDF to EPUB conversion is unavailable');
    }
  }

  private parseConversionTimeout(value: string | undefined): number {
    if (!value) return DEFAULT_CONVERSION_TIMEOUT_MS;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONVERSION_TIMEOUT_MS;
  }
}
