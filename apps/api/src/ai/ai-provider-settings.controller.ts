import type { AiProviderResponse, TestAiProviderResponse } from '@food/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly } from '../auth/admin-only.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UpdateAiProviderDto } from './ai-provider-settings.dto.js';
import { AiProviderSettingsService } from './ai-provider-settings.service.js';

export const AI_PROVIDER_TEST_THROTTLE = {
  long: { limit: 20, ttl: 60_000 },
} as const;

@AdminOnly()
@Controller('admin/ai-provider')
export class AiProviderSettingsController {
  constructor(private readonly settings: AiProviderSettingsService) {}

  @Get()
  async get(): Promise<AiProviderResponse> {
    await this.settings.refresh();
    return this.settings.describe();
  }

  @Put()
  update(
    @CurrentUser() actor: AuthUser,
    @Body() body: UpdateAiProviderDto,
  ): Promise<AiProviderResponse> {
    return this.settings.save(actor.id, body);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  remove(): Promise<AiProviderResponse> {
    return this.settings.remove();
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Throttle(AI_PROVIDER_TEST_THROTTLE)
  test(@Body() body: UpdateAiProviderDto): Promise<TestAiProviderResponse> {
    return this.settings.test(body);
  }
}
