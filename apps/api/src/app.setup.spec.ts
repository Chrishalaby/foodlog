import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX, configureApp } from './app.setup.js';

@Module({})
class EmptyModule {}

describe('configureApp', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    app = await NestFactory.create<NestExpressApplication>(EmptyModule, {
      logger: false,
      bodyParser: false,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('exits cleanly after the shutdown hooks instead of re-raising the signal', () => {
    const enableShutdownHooks = vi.spyOn(app, 'enableShutdownHooks');

    configureApp(app);

    expect(enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(enableShutdownHooks).toHaveBeenCalledWith([], {
      useProcessExit: true,
    });
  });

  it('serves the API under its global prefix', () => {
    const setGlobalPrefix = vi.spyOn(app, 'setGlobalPrefix');

    configureApp(app);

    expect(setGlobalPrefix).toHaveBeenCalledWith(API_PREFIX);
  });
});
