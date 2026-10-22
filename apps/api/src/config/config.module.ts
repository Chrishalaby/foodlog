import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig } from './app-config.js';
import { ENV_FILE_PATHS, type EnvRecord } from './env-files.js';
import { type AppSettings, parseSettings } from './settings.js';

const APP_SETTINGS_KEY = '__appSettings';

function validateEnvironment(env: EnvRecord): Record<string, unknown> {
  return { ...env, [APP_SETTINGS_KEY]: parseSettings(env) };
}

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ENV_FILE_PATHS,
      validate: validateEnvironment,
    }),
  ],
  providers: [
    {
      provide: AppConfig,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AppConfig =>
        new AppConfig(config.getOrThrow<AppSettings>(APP_SETTINGS_KEY)),
    },
  ],
  exports: [AppConfig],
})
export class AppConfigModule {}
