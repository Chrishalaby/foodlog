import { Module } from '@nestjs/common';
import { PhotosModule } from '../photos/photos.module.js';
import {
  defaultOffFetch,
  OFF_FETCH,
  OpenFoodFactsClient,
} from './open-food-facts.client.js';
import { ProductLogService } from './product-log.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [PhotosModule],
  controllers: [ProductsController],
  providers: [
    { provide: OFF_FETCH, useValue: defaultOffFetch },
    OpenFoodFactsClient,
    ProductsService,
    ProductLogService,
  ],
  exports: [ProductLogService],
})
export class ProductsModule {}
