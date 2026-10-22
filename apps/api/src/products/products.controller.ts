import type { BarcodeLookupResponse, EntryDto, ProductDto } from '@food/shared';
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
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ParseBarcodePipe } from './parse-barcode.pipe.js';
import { productAmount } from './product-log.js';
import { ProductLogService } from './product-log.service.js';
import { LogProductDto, UpsertProductDto } from './products.dto.js';
import { ProductsService } from './products.service.js';

export const BARCODE_LOOKUP_THROTTLE = {
  long: { limit: 60, ttl: 60_000 },
} as const;

@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly productLog: ProductLogService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ProductDto[]> {
    return this.products.list(user.id);
  }

  @Get('barcode/:code')
  @Throttle(BARCODE_LOOKUP_THROTTLE)
  lookup(
    @CurrentUser() user: AuthUser,
    @Param('code', ParseBarcodePipe) barcode: string,
  ): Promise<BarcodeLookupResponse> {
    return this.products.lookup(user.id, barcode);
  }

  @Put('barcode/:code')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('code', ParseBarcodePipe) barcode: string,
    @Body() body: UpsertProductDto,
  ): Promise<ProductDto> {
    return this.products.upsert(user.id, barcode, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.products.remove(user.id, id);
  }

  @Post(':id/log')
  log(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LogProductDto,
  ): Promise<EntryDto> {
    return this.productLog.log(user.id, id, {
      amount: productAmount(body.grams, body.servings),
      timestamp: body.timestamp,
      localDate: body.localDate,
      mealType: body.mealType,
      analysisId: body.analysisId,
      photoId: body.photoId,
      description: body.description,
    });
  }
}
