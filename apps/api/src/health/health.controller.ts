import type { HealthResponse } from '@food/shared';
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { SkipAllThrottlers } from '../common/throttling.js';
import { readAppVersion } from './app-version.js';

@Public()
@SkipAllThrottlers()
@Controller('health')
export class HealthController {
  private readonly version = readAppVersion();

  @Get()
  health(): HealthResponse {
    return { status: 'ok', version: this.version };
  }
}
