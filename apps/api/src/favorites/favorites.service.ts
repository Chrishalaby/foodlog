import type { EntryDto, FavoriteDto } from '@food/shared';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FAVORITE_INCLUDE,
  parseFavoriteItems,
  toEntryDto,
  toFavoriteDto,
} from '../common/mappers.js';
import { portionFromColumns, scaledPortion } from '../common/portions.js';
import { withOwnedProductLinks } from '../common/product-links.js';
import { createLinkedEntry } from '../entries/entry-create.js';
import { toEntryItemInput } from '../entries/entry-data.js';
import { entryNotFound } from '../entries/entry-errors.js';
import { singleEntryPhoto } from '../entries/entry-photos.js';
import { releasePhoto } from '../entries/release-photo.js';
import type { Favorite, Prisma } from '../generated/prisma/client.js';
import { PhotosService } from '../photos/photos.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { favoriteCreateData, favoriteUpdateData } from './favorite-data.js';
import {
  DEFAULT_SERVINGS,
  favoriteEntryName,
  isWithinItemLimits,
  scaleFavoriteItems,
} from './favorite-servings.js';
import type {
  CreateFavoriteDto,
  CreateFavoriteFromEntryDto,
  LogFavoriteDto,
  UpdateFavoriteDto,
} from './favorites.dto.js';

type FavoriteClient = Pick<Prisma.TransactionClient, 'favorite'>;

export const FAVORITE_ORDER: Prisma.FavoriteOrderByWithRelationInput[] = [
  { useCount: 'desc' },
  { lastUsedAt: { sort: 'desc', nulls: 'last' } },
  { name: 'asc' },
  { id: 'asc' },
];

function favoriteNotFound(): NotFoundException {
  return new NotFoundException('Favorite not found');
}

@Injectable()
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
  ) {}

  async list(userId: string): Promise<FavoriteDto[]> {
    const favorites = await this.prisma.favorite.findMany({
      where: { userId },
      orderBy: FAVORITE_ORDER,
      include: FAVORITE_INCLUDE,
    });
    return favorites.map(toFavoriteDto);
  }

  async create(userId: string, dto: CreateFavoriteDto): Promise<FavoriteDto> {
    const photoId = dto.photoId
      ? (await this.photos.findOwned(userId, dto.photoId)).id
      : null;
    const favorite = await this.prisma.favorite.create({
      data: favoriteCreateData({
        userId,
        photoId,
        name: dto.name,
        mealType: dto.mealType ?? null,
        items: await withOwnedProductLinks(this.prisma, userId, dto.items),
        portion: dto.portion ?? null,
      }),
      include: FAVORITE_INCLUDE,
    });
    return toFavoriteDto(favorite);
  }

  async createFromEntry(
    userId: string,
    entryId: string,
    dto: CreateFavoriteFromEntryDto,
  ): Promise<FavoriteDto> {
    const entry = await this.prisma.entry.findFirst({
      where: { id: entryId, userId },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!entry) {
      throw entryNotFound();
    }
    const favorite = await this.prisma.favorite.create({
      data: favoriteCreateData({
        userId,
        photoId: entry.photoId,
        name: dto.name ?? entry.name,
        mealType: null,
        items: entry.items.map(toEntryItemInput),
        portion: portionFromColumns(entry),
      }),
      include: FAVORITE_INCLUDE,
    });
    return toFavoriteDto(favorite);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateFavoriteDto,
  ): Promise<FavoriteDto> {
    await this.requireFavorite(this.prisma, userId, id);
    const favorite = await this.prisma.favorite.update({
      where: { id, userId },
      data: favoriteUpdateData({
        name: dto.name,
        mealType: dto.mealType,
        items: await withOwnedProductLinks(this.prisma, userId, dto.items),
        portion: dto.portion,
      }),
      include: FAVORITE_INCLUDE,
    });
    return toFavoriteDto(favorite);
  }

  async remove(userId: string, id: string): Promise<void> {
    const favorite = await this.requireFavorite(this.prisma, userId, id);
    await this.prisma.favorite.delete({ where: { id: favorite.id } });
    await releasePhoto(this.photos, this.logger, favorite.photoId);
  }

  async log(
    userId: string,
    id: string,
    dto: LogFavoriteDto,
  ): Promise<EntryDto> {
    const servings = dto.servings ?? DEFAULT_SERVINGS;
    const entry = await this.prisma.$transaction(async (tx) => {
      const favorite = await this.requireFavorite(tx, userId, id);
      const items = scaleFavoriteItems(
        parseFavoriteItems(favorite.items),
        servings,
      );
      if (!items.every(isWithinItemLimits)) {
        throw new BadRequestException(
          'servings is too large: a scaled item would exceed the item limits',
        );
      }
      const portion = scaledPortion(portionFromColumns(favorite), servings);
      await tx.favorite.update({
        where: { id: favorite.id },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      });
      return createLinkedEntry(tx, {
        userId,
        name: favoriteEntryName(favorite.name, servings, portion !== null),
        description: null,
        mealType: dto.mealType,
        source: 'favorite',
        timestamp: new Date(dto.timestamp),
        localDate: dto.localDate,
        items,
        portion,
        ...singleEntryPhoto(favorite.photoId),
        analysisId: null,
        favoriteId: favorite.id,
        rawAiJson: null,
      });
    });
    return toEntryDto(entry);
  }

  private async requireFavorite(
    client: FavoriteClient,
    userId: string,
    id: string,
  ): Promise<Favorite> {
    const favorite = await client.favorite.findFirst({
      where: { id, userId },
    });
    if (!favorite) {
      throw favoriteNotFound();
    }
    return favorite;
  }
}
