import {
  ACCESS_REQUEST_STATUSES,
  type AccessRequestStatus,
  type CreateInviteRequest,
  USER_ROLES,
  USER_STATUSES,
  type UpdateAdminUserRequest,
  type UserRole,
  type UserStatus,
} from '@food/shared';
import {
  buildMessage,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { IsNormalizedEmail, IsOptionalPersonName } from '../auth/auth.dto.js';

export const MAX_MONTHLY_BUDGET_USD = 10_000;

function isPresent(_object: object, value: unknown): boolean {
  return value !== undefined;
}

function IsNotWithCustomBudget(): PropertyDecorator {
  return ValidateBy({
    name: 'isNotWithCustomBudget',
    validator: {
      validate: (value: unknown, args): boolean => {
        const dto = args?.object as Partial<UpdateAdminUserRequest> | undefined;
        return value !== true || typeof dto?.aiMonthlyBudgetUsd !== 'number';
      },
      defaultMessage: buildMessage(
        (each) =>
          `${each}$property cannot be true when aiMonthlyBudgetUsd is a number`,
      ),
    },
  });
}

export class UpdateAdminUserDto implements UpdateAdminUserRequest {
  @ValidateIf(isPresent)
  @IsIn(USER_ROLES)
  role?: UserRole;

  @ValidateIf(isPresent)
  @IsIn(USER_STATUSES)
  status?: UserStatus;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONTHLY_BUDGET_USD)
  aiMonthlyBudgetUsd?: number | null;

  @ValidateIf(isPresent)
  @IsBoolean()
  @IsNotWithCustomBudget()
  aiBudgetUnlimited?: boolean;

  @IsOptionalPersonName()
  name?: string | null;
}

export class AdminAccessRequestsQueryDto {
  @IsOptional()
  @IsIn(ACCESS_REQUEST_STATUSES)
  status?: AccessRequestStatus;
}

export class CreateInviteDto implements CreateInviteRequest {
  @IsNormalizedEmail()
  email: string;

  @IsOptionalPersonName()
  name?: string | null;

  @ValidateIf(isPresent)
  @IsIn(USER_ROLES)
  role?: UserRole;
}
