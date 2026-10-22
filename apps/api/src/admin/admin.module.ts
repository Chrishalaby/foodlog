import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { AdminAccessRequestsController } from './admin-access-requests.controller.js';
import { AdminAccessRequestsService } from './admin-access-requests.service.js';
import { AdminInvitesController } from './admin-invites.controller.js';
import { AdminInvitesService } from './admin-invites.service.js';
import { AdminOverviewService } from './admin-overview.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';

@Module({
  imports: [AuthModule, StorageModule, UsageModule],
  controllers: [
    AdminUsersController,
    AdminAccessRequestsController,
    AdminInvitesController,
  ],
  providers: [
    AdminAccessRequestsService,
    AdminInvitesService,
    AdminOverviewService,
    AdminUsersService,
  ],
})
export class AdminModule {}
