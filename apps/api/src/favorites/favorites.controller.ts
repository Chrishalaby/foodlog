import type { EntryDto, FavoriteDto } from '@food/shared';
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
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  CreateFavoriteDto,
  CreateFavoriteFromEntryDto,
  LogFavoriteDto,
  UpdateFavoriteDto,
} from './favorites.dto.js';
import { FavoritesService } from './favorites.service.js';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<FavoriteDto[]> {
    return this.favorites.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateFavoriteDto,
  ): Promise<FavoriteDto> {
    return this.favorites.create(user.id, body);
  }

  @Post('from-entry/:entryId')
  createFromEntry(
    @CurrentUser() user: AuthUser,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() body: CreateFavoriteFromEntryDto,
  ): Promise<FavoriteDto> {
    return this.favorites.createFromEntry(user.id, entryId, body);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateFavoriteDto,
  ): Promise<FavoriteDto> {
    return this.favorites.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.favorites.remove(user.id, id);
  }

  @Post(':id/log')
  log(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LogFavoriteDto,
  ): Promise<EntryDto> {
    return this.favorites.log(user.id, id, body);
  }
}
