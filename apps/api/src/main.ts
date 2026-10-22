import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { AppConfig } from './config/app-config.js';

async function bootstrap(): Promise<void> {
  const app = configureApp(
    await NestFactory.create<NestExpressApplication>(AppModule, {
      bodyParser: false,
    }),
  );
  const { port, host } = app.get(AppConfig);
  await app.listen(port, host);
  Logger.log(`FoodLog API listening on port ${port}`, 'Bootstrap');
}

await bootstrap();
