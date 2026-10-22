import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessModule } from './access/access.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AiModule } from './ai/ai.module.js';
import { CompareModule } from './compare/compare.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { APP_THROTTLERS } from './common/throttling.js';
import { AppConfigModule } from './config/config.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DemoModule } from './demo/demo.module.js';
import { DaysModule } from './days/days.module.js';
import { DraftsModule } from './drafts/drafts.module.js';
import { EntriesModule } from './entries/entries.module.js';
import { ExportModule } from './export/export.module.js';
import { FavoritesModule } from './favorites/favorites.module.js';
import { FluidsModule } from './fluids/fluids.module.js';
import { FoodsModule } from './foods/foods.module.js';
import { HealthModule } from './health/health.module.js';
import { ImportModule } from './import/import.module.js';
import { InsightsModule } from './insights/insights.module.js';
import { MealIdeasModule } from './meal-ideas/meal-ideas.module.js';
import { MyFoodsModule } from './my-foods/my-foods.module.js';
import { NotesModule } from './notes/notes.module.js';
import { PhotosModule } from './photos/photos.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProductsModule } from './products/products.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsageModule } from './usage/usage.module.js';
import { VoiceModule } from './voice/voice.module.js';
import { WeightsModule } from './weights/weights.module.js';
import { webStaticModule } from './web/web-static.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ThrottlerModule.forRoot({ throttlers: [...APP_THROTTLERS] }),
    AuthModule,
    HealthModule,
    StorageModule,
    PhotosModule,
    AiModule,
    UsageModule,
    EntriesModule,
    FavoritesModule,
    DaysModule,
    ProfileModule,
    DashboardModule,
    InsightsModule,
    ExportModule,
    ImportModule,
    FoodsModule,
    CatalogModule,
    DemoModule,
    WeightsModule,
    ProductsModule,
    MyFoodsModule,
    FluidsModule,
    AccessModule,
    AdminModule,
    DraftsModule,
    CompareModule,
    MealIdeasModule,
    VoiceModule,
    NotesModule,
    webStaticModule(),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
})
export class AppModule {}
