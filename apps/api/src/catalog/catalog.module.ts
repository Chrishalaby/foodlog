import { Module } from '@nestjs/common';
import { CatalogLoaderService } from './catalog-loader.service.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CatalogLoaderService],
  exports: [CatalogService, CatalogLoaderService],
})
export class CatalogModule {}
