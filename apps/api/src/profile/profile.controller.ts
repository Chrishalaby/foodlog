import type { ProfileResponse } from '@food/shared';
import { Body, Controller, Get, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UpdateProfileDto } from './profile.dto.js';
import { ProfileService } from './profile.service.js';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<ProfileResponse> {
    return this.profiles.getResponse(user.id);
  }

  @Put()
  update(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    return this.profiles.update(user.id, body);
  }
}
