import type { UserDto } from '@food/shared';
import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { readUserAgent, SessionCookies } from '../auth/session-cookies.js';
import { DemoStartDto } from './demo.dto.js';
import { DemoService } from './demo.service.js';

export const DEMO_START_THROTTLE = {
  long: { limit: 10, ttl: 60 * 60_000 },
} as const;

@Controller('demo')
export class DemoController {
  constructor(
    private readonly demo: DemoService,
    private readonly cookies: SessionCookies,
  ) {}

  @Public()
  @Throttle(DEMO_START_THROTTLE)
  @Post('start')
  async start(
    @Body() body: DemoStartDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserDto> {
    const { user, token } = await this.demo.start(body, readUserAgent(request));
    this.cookies.set(response, token);
    return user;
  }
}
