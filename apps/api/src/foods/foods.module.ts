import { Module } from '@nestjs/common';
import { FavoritesModule } from '../favorites/favorites.module.js';
import { ProductsModule } from '../products/products.module.js';
import { FoodLibraryRepository } from './food-library.repository.js';
import { FoodRenameService } from './food-rename.service.js';
import { FoodSearchService } from './food-search.service.js';
import { FoodsController } from './foods.controller.js';
import { HiddenFoodsService } from './hidden-foods.service.js';
import { QuickLogService } from './quick-log.service.js';

@Module({
  imports: [FavoritesModule, ProductsModule],
  controllers: [FoodsController],
  providers: [
    FoodLibraryRepository,
    FoodSearchService,
    QuickLogService,
    FoodRenameService,
    HiddenFoodsService,
  ],
  exports: [FoodSearchService],
})
export class FoodsModule {}
