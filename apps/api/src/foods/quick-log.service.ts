import type { EntryDto } from '@food/shared';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseFavoriteItems, toEntryDto } from '../common/mappers.js';
import { itemPortion, portionFromColumns } from '../common/portions.js';
import { createLinkedEntry } from '../entries/entry-create.js';
import { type NewEntry, toEntryItemInput } from '../entries/entry-data.js';
import {
  coverEntryPhoto,
  STORED_ENTRY_PHOTOS,
  storedEntryPhotos,
} from '../entries/entry-photos.js';
import { FavoritesService } from '../favorites/favorites.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { productAmount } from '../products/product-log.js';
import { ProductLogService } from '../products/product-log.service.js';
import { FOOD_KEY_MESSAGE, parseFoodKey } from './food-key.js';
import type { QuickLogDto } from './foods.dto.js';
import {
  assertSingleAmount,
  isSet,
  NO_PORTION_MESSAGE,
  portionCountFactor,
  scaleLibraryFood,
  servingsForGrams,
} from './quick-log-amount.js';

type LoggedEntryFields = Pick<
  NewEntry,
  'userId' | 'source' | 'mealType' | 'timestamp' | 'localDate' | 'analysisId'
>;

function foodNotFound(): NotFoundException {
  return new NotFoundException('Food not found');
}

function loggedEntryFields(
  userId: string,
  dto: QuickLogDto,
): LoggedEntryFields {
  return {
    userId,
    source: 'copy',
    mealType: dto.mealType,
    timestamp: new Date(dto.timestamp),
    localDate: dto.localDate,
    analysisId: null,
  };
}

@Injectable()
export class QuickLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly favorites: FavoritesService,
    private readonly products: ProductLogService,
  ) {}

  async log(userId: string, dto: QuickLogDto): Promise<EntryDto> {
    const key = parseFoodKey(dto.key);
    if (!key) {
      throw new BadRequestException(FOOD_KEY_MESSAGE);
    }
    assertSingleAmount(dto);
    switch (key.kind) {
      case 'favorite':
        return this.logFavorite(userId, key.id, dto);
      case 'meal':
        return this.logMeal(userId, key.id, dto);
      case 'food':
        return this.logFood(userId, key.id, dto);
      case 'product':
        return this.logProduct(userId, key.id, dto);
    }
  }

  private logProduct(
    userId: string,
    id: string,
    dto: QuickLogDto,
  ): Promise<EntryDto> {
    if (isSet(dto.portionCount)) {
      throw new BadRequestException(NO_PORTION_MESSAGE);
    }
    return this.products.log(userId, id, {
      amount: productAmount(dto.grams, dto.servings),
      timestamp: dto.timestamp,
      localDate: dto.localDate,
      mealType: dto.mealType,
    });
  }

  private async logFavorite(
    userId: string,
    id: string,
    dto: QuickLogDto,
  ): Promise<EntryDto> {
    return this.favorites.log(userId, id, {
      timestamp: dto.timestamp,
      localDate: dto.localDate,
      mealType: dto.mealType,
      servings: await this.favoriteServings(userId, id, dto),
    });
  }

  private async favoriteServings(
    userId: string,
    id: string,
    dto: QuickLogDto,
  ): Promise<number | undefined> {
    if (isSet(dto.portionCount)) {
      const favorite = await this.requireFavoriteAmounts(userId, id);
      return portionCountFactor(portionFromColumns(favorite), dto.portionCount);
    }
    if (isSet(dto.grams)) {
      const favorite = await this.requireFavoriteAmounts(userId, id);
      return servingsForGrams(parseFavoriteItems(favorite.items), dto.grams);
    }
    return dto.servings;
  }

  private async requireFavoriteAmounts(userId: string, id: string) {
    const favorite = await this.prisma.favorite.findFirst({
      where: { id, userId },
      select: {
        items: true,
        portionCount: true,
        portionUnit: true,
        portionUnitPlural: true,
      },
    });
    if (!favorite) {
      throw new NotFoundException('Favorite not found');
    }
    return favorite;
  }

  private async logMeal(
    userId: string,
    id: string,
    dto: QuickLogDto,
  ): Promise<EntryDto> {
    const entry = await this.prisma.$transaction(async (tx) => {
      const source = await tx.entry.findFirst({
        where: { id, userId },
        include: {
          items: { orderBy: { position: 'asc' } },
          photos: STORED_ENTRY_PHOTOS,
        },
      });
      if (!source) {
        throw foodNotFound();
      }
      const scaled = scaleLibraryFood(
        {
          items: source.items.map(toEntryItemInput),
          portion: portionFromColumns(source),
        },
        dto,
      );
      return createLinkedEntry(tx, {
        ...loggedEntryFields(userId, dto),
        name: source.name,
        description: source.description,
        ...scaled,
        ...storedEntryPhotos(source),
        favoriteId: source.favoriteId,
        rawAiJson: source.rawAiJson,
      });
    });
    return toEntryDto(entry);
  }

  private async logFood(
    userId: string,
    id: string,
    dto: QuickLogDto,
  ): Promise<EntryDto> {
    const entry = await this.prisma.$transaction(async (tx) => {
      const item = await tx.entryItem.findFirst({
        where: { id, entry: { userId } },
        include: {
          entry: {
            select: {
              source: true,
              photoId: true,
              photos: STORED_ENTRY_PHOTOS,
            },
          },
        },
      });
      if (!item) {
        throw foodNotFound();
      }
      const scaled = scaleLibraryFood(
        { items: [toEntryItemInput(item)], portion: itemPortion(item) },
        dto,
      );
      return createLinkedEntry(tx, {
        ...loggedEntryFields(userId, dto),
        name: item.name,
        description: null,
        ...scaled,
        ...coverEntryPhoto(storedEntryPhotos(item.entry)),
        favoriteId: null,
        rawAiJson: null,
      });
    });
    return toEntryDto(entry);
  }
}
