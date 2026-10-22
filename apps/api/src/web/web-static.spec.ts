import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ServeStaticModule } from '@nestjs/serve-static';
import request from 'supertest';
import { configureApp } from '../app.setup.js';
import {
  cacheControlFor,
  IMMUTABLE_CACHE,
  NO_CACHE,
  SPA_FALLBACK_EXCLUDE,
  webStaticOptions,
} from './web-static.js';

describe('cacheControlFor', () => {
  it.each([
    'index.html',
    'ngsw.json',
    'ngsw-worker.js',
    'safety-worker.js',
    'manifest.webmanifest',
    'notes.webmanifest',
    'notes-app.webmanifest',
  ])('disables caching for %s', (file) => {
    expect(cacheControlFor(`/app/web/${file}`)).toBe(NO_CACHE);
  });

  it.each([
    'main-BXJ2CVPT.js',
    'chunk-5FUXMIF4.js',
    'chunk-B1YzTMgV.js',
    'chunk-CrM-yqx9.js',
    'chunk-a_EEtaP6.js',
    'polyfills-FFHMD2TL.mjs',
    'styles-TO3JL4AD.css',
    'media/inter-latin-4WHLZNUE.woff2',
  ])('caches hashed file %s forever', (file) => {
    expect(cacheControlFor(`/app/web/${file}`)).toBe(IMMUTABLE_CACHE);
  });

  it.each([
    'favicon.ico',
    'favicon-32x32.png',
    'icons/icon-192x192.png',
    'images/photo-portrait.jpg',
    'robots.txt',
    'main.js',
    'some-long-name.js',
  ])('leaves %s with the default policy', (file) => {
    expect(cacheControlFor(`/app/web/${file}`)).toBeNull();
  });
});

describe('webStaticOptions', () => {
  it('serves nothing when the web build is missing', () => {
    expect(webStaticOptions('/definitely/not/here')).toEqual([]);
  });

  it('serves an existing build and excludes the API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'foodlog-web-'));
    try {
      const [options] = webStaticOptions(dir);
      expect(options?.rootPath).toBe(dir);
      expect(options?.exclude).toBe(SPA_FALLBACK_EXCLUDE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('SPA_FALLBACK_EXCLUDE', () => {
  it.each([
    '/api',
    '/api/',
    '/api/foods/search',
    '/chunk-ZZZZZZZZ.js',
    '/main-OLD12345.js',
    '/styles-OLD12345.css',
    '/media/zxing_reader-ZZZZZZZZ.wasm',
    '/favicon.ico',
  ])('sends %s past the app shell', (path) => {
    expect(SPA_FALLBACK_EXCLUDE.test(path)).toBe(true);
  });

  it.each([
    '/',
    '/today',
    '/log',
    '/invite/Ab_-9xYz',
    '/reset/Ab_-9xYz',
    '/entries/0b6f6c1e-1d2a-4c3b-9e8f-1234567890ab',
    '/apix',
    '/api-docs',
    '/.well-known/thing',
  ])('serves the app shell for %s', (path) => {
    expect(SPA_FALLBACK_EXCLUDE.test(path)).toBe(false);
  });
});

describe('web app serving', () => {
  const INDEX_HTML = '<html>app</html>';
  const NOTES_MANIFEST = '{"name":"Notes","start_url":"/notes"}';
  let dir: string;
  let app: NestExpressApplication;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'foodlog-web-serving-'));
    await writeFile(join(dir, 'index.html'), INDEX_HTML);
    await writeFile(join(dir, 'chunk-ABCD1234.js'), 'export {};');
    await writeFile(join(dir, 'notes.webmanifest'), NOTES_MANIFEST);
    app = configureApp(
      await NestFactory.create<NestExpressApplication>(
        ServeStaticModule.forRoot(...webStaticOptions(dir)),
        { logger: false, bodyParser: false },
      ),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it.each(['/', '/today', '/notes', '/invite/abc_-DEF', '/today?next=a.b'])(
    'serves the app shell for the route %s',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path).expect(200);

      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.headers['cache-control']).toBe(NO_CACHE);
      expect(response.text).toBe(INDEX_HTML);
    },
  );

  it('serves the notes app manifest without caching it', async () => {
    const response = await request(app.getHttpServer())
      .get('/notes.webmanifest')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(response.headers['cache-control']).toBe(NO_CACHE);
    expect((response.body as Buffer).toString('utf8')).toBe(NOTES_MANIFEST);
  });

  it('serves an existing hashed chunk with the immutable cache policy', async () => {
    const response = await request(app.getHttpServer())
      .get('/chunk-ABCD1234.js')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.headers['cache-control']).toBe(IMMUTABLE_CACHE);
  });

  it.each([
    '/chunk-ZZZZZZZZ.js',
    '/media/zxing_reader-ZZZZZZZZ.wasm',
    '/favicon.ico',
    '/api/nope',
  ])(
    'answers the missing file %s with 404 instead of the app shell',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path).expect(404);

      expect(response.text).not.toContain(INDEX_HTML);
      expect(response.headers['cache-control']).toBeUndefined();
    },
  );
});
