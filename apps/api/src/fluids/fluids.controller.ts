import type { FluidDayResponse, FluidLogDto } from '@food/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  CreateFluidLogDto,
  FluidDayQueryDto,
  UpdateFluidLogDto,
} from './fluids.dto.js';
import { FluidsService } from './fluids.service.js';

@Controller('fluids')
export class FluidsController {
  constructor(private readonly fluids: FluidsService) {}

  @Get()
  day(
    @CurrentUser() user: AuthUser,
    @Query() query: FluidDayQueryDto,
  ): Promise<FluidDayResponse> {
    return this.fluids.day(user.id, query.date);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateFluidLogDto,
  ): Promise<FluidLogDto> {
    return this.fluids.create(user.id, body);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateFluidLogDto,
  ): Promise<FluidLogDto> {
    return this.fluids.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.fluids.remove(user.id, id);
  }
}
