import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { MEAL_IDEAS_AI_PROVIDER } from '../ai/providers/ai-provider.js';
import { RuntimeAiProvider } from '../ai/providers/runtime-ai-provider.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { FoodsModule } from '../foods/foods.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { MealIdeasController } from './meal-ideas.controller.js';
import { MealIdeasService } from './meal-ideas.service.js';

@Module({
  imports: [AiModule, UsageModule, DashboardModule, FoodsModule],
  controllers: [MealIdeasController],
  providers: [
    MealIdeasService,
    { provide: MEAL_IDEAS_AI_PROVIDER, useExisting: RuntimeAiProvider },
  ],
})
export class MealIdeasModule {}
