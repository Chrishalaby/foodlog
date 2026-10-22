import { existsSync } from 'node:fs';
import { basename, sep } from 'node:path';
import { type DynamicModule, Logger } from '@nestjs/common';
import {
  ServeStaticModule,
  type ServeStaticModuleOptions,
} from '@nestjs/serve-static';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config.js';

const NO_CACHE_FILES = new Set([
  'index.html',
  'ngsw.json',
  'ngsw-worker.js',
  'safety-worker.js',
  'manifest.webmanifest',
  'notes.webmanifest',
  'notes-app.webmanifest',
]);

const HASHED_BUNDLE_PATTERN = /-[A-Za-z0-9_-]{8}\.(?:m?js|css)$/;
const HASHED_MEDIA_PATTERN = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
const MEDIA_SEGMENT = `${sep}media${sep}`;

export const SPA_FALLBACK_EXCLUDE = /^\/api(?:\/|$)|\/[^/]*\.[A-Za-z0-9]+$/;
export const NO_CACHE = 'no-cache';
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export function cacheControlFor(filePath: string): string | null {
  const name = basename(filePath);
  if (NO_CACHE_FILES.has(name)) {
    return NO_CACHE;
  }
  const hashed =
    HASHED_BUNDLE_PATTERN.test(name) ||
    (filePath.includes(MEDIA_SEGMENT) && HASHED_MEDIA_PATTERN.test(name));
  return hashed ? IMMUTABLE_CACHE : null;
}

function setCacheHeaders(response: Response, filePath: string): void {
  const cacheControl = cacheControlFor(filePath);
  if (cacheControl) {
    response.setHeader('Cache-Control', cacheControl);
  }
}

export function webStaticOptions(
  webDistDir: string,
): ServeStaticModuleOptions[] {
  const logger = new Logger('WebApp');
  if (!existsSync(webDistDir)) {
    logger.warn(`Web build not found at ${webDistDir}; serving the API only`);
    return [];
  }
  logger.log(`Serving the web app from ${webDistDir}`);
  return [
    {
      rootPath: webDistDir,
      exclude: SPA_FALLBACK_EXCLUDE,
      serveStaticOptions: { setHeaders: setCacheHeaders },
    },
  ];
}

export function webStaticModule(): DynamicModule {
  return ServeStaticModule.forRootAsync({
    inject: [AppConfig],
    useFactory: (config: AppConfig) => webStaticOptions(config.webDistDir),
  });
}
