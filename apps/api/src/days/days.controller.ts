import type { DayMetaDto } from '@food/shared';
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UpdateDayMetaDto } from './days.dto.js';
import { DaysService } from './days.service.js';
import { ParseLocalDatePipe } from './local-date.pipe.js';

@Controller('days')
export class DaysController {
  constructor(private readonly days: DaysService) {}

  @Get(':date')
  get(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseLocalDatePipe) date: string,
  ): Promise<DayMetaDto> {
    return this.days.get(user.id, date);
  }

  @Put(':date')
  put(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseLocalDatePipe) date: string,
    @Body() body: UpdateDayMetaDto,
  ): Promise<DayMetaDto> {
    return this.days.put(user.id, date, body);
  }
}
