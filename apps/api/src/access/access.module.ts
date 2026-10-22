import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccessController } from './access.controller.js';
import { AccessService } from './access.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AccessController],
  providers: [AccessService],
})
export class AccessModule {}
