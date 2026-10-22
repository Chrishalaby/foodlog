import { Module } from '@nestjs/common';
import { FoodMergesService } from './food-merges.service.js';
import { MyFoodsController } from './my-foods.controller.js';
import { MyFoodsService } from './my-foods.service.js';

@Module({
  controllers: [MyFoodsController],
  providers: [MyFoodsService, FoodMergesService],
})
export class MyFoodsModule {}
