import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { SecretsModule } from '../secrets/secrets.module.js';
import { SecretsService } from '../secrets/secrets.service.js';
import { AccountsService } from './accounts.service.js';
import { AdminGuard } from './admin-only.decorator.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthTokensController } from './auth-tokens.controller.js';
import { AuthTokensService } from './auth-tokens.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { SessionCookies } from './session-cookies.js';
import { SessionTokens } from './session-tokens.service.js';
import { SessionsService } from './sessions.service.js';
import { SetupCodeService } from './setup-code.service.js';

async function jwtOptions(secrets: SecretsService): Promise<JwtModuleOptions> {
  return {
    secret: await secrets.jwtSecret(),
    signOptions: { algorithm: 'HS256' },
    verifyOptions: { algorithms: ['HS256'] },
  };
}

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      imports: [SecretsModule],
      inject: [SecretsService],
      useFactory: jwtOptions,
    }),
  ],
  controllers: [AuthController, AuthTokensController],
  providers: [
    AccountsService,
    AdminGuard,
    AuthService,
    AuthTokensService,
    SessionCookies,
    SessionTokens,
    SessionsService,
    SetupCodeService,
    JwtAuthGuard,
  ],
  exports: [
    AccountsService,
    AdminGuard,
    AuthTokensService,
    SessionCookies,
    SessionsService,
    SessionTokens,
    JwtAuthGuard,
  ],
})
export class AuthModule {}
