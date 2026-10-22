import type {
  EntryDto,
  EntryListResponse,
  EntryRawAiResponse,
} from '@food/shared';
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
  CreateEntryDto,
  DuplicateEntryDto,
  EntryListQueryDto,
  UpdateEntryDto,
} from './entries.dto.js';
import { EntriesService } from './entries.service.js';

@Controller('entries')
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: EntryListQueryDto,
  ): Promise<EntryListResponse> {
    return this.entries.list(user.id, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EntryDto> {
    return this.entries.get(user.id, id);
  }

  @Get(':id/raw-ai')
  rawAi(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EntryRawAiResponse> {
    return this.entries.rawAi(user.id, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateEntryDto,
  ): Promise<EntryDto> {
    return this.entries.create(user.id, body);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateEntryDto,
  ): Promise<EntryDto> {
    return this.entries.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.entries.remove(user.id, id);
  }

  @Post(':id/duplicate')
  duplicate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DuplicateEntryDto,
  ): Promise<EntryDto> {
    return this.entries.duplicate(user.id, id, body);
  }
}
