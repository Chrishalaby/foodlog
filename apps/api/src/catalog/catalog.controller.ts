import type {
  CatalogFoodDto,
  CatalogInfoResponse,
  CatalogSearchResponse,
} from '@food/shared';
import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { CatalogSearchQueryDto } from './catalog.dto.js';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  info(): Promise<CatalogInfoResponse> {
    return this.catalog.info();
  }

  @Get('foods')
  search(@Query() query: CatalogSearchQueryDto): Promise<CatalogSearchResponse> {
    return this.catalog.search(query);
  }

  @Get('foods/:id')
  get(@Param('id', ParseIntPipe) id: number): Promise<CatalogFoodDto> {
    return this.catalog.get(id);
  }
}
