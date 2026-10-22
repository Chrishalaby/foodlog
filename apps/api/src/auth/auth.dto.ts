import {
  API_LIMITS,
  type AcceptAuthTokenRequest,
  type ChangePasswordRequest,
  type LoginRequest,
  type SetupRequest,
  type UpdateAccountRequest,
} from '@food/shared';
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const EMAIL_MAX_LENGTH = 254;
const SETUP_CODE_MAX_LENGTH = 200;
const WITHOUT_CONTROL_CHARACTERS = /^\P{Cc}*$/u;

function normalizeEmail({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function trimToNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function PlainText(maxLength: number): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MaxLength(maxLength),
    Matches(WITHOUT_CONTROL_CHARACTERS, {
      message: '$property must not contain control characters',
    }),
  );
}

export function IsNormalizedEmail(): PropertyDecorator {
  return applyDecorators(
    Transform(normalizeEmail),
    IsEmail(),
    MaxLength(EMAIL_MAX_LENGTH),
  );
}

export function IsNewPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    Length(API_LIMITS.passwordMin, API_LIMITS.passwordMax),
  );
}

export function IsExistingPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    IsNotEmpty(),
    MaxLength(API_LIMITS.passwordMax),
  );
}

export function IsPersonName(): PropertyDecorator {
  return applyDecorators(
    Transform(trim),
    IsNotEmpty(),
    PlainText(API_LIMITS.personNameMax),
  );
}

export function IsOptionalPersonName(): PropertyDecorator {
  return applyDecorators(
    Transform(trimToNull),
    IsOptional(),
    PlainText(API_LIMITS.personNameMax),
  );
}

export function IsNullablePersonName(): PropertyDecorator {
  return applyDecorators(
    Transform(trimToNull),
    ValidateIf((_object, value) => value !== null),
    PlainText(API_LIMITS.personNameMax),
  );
}

export function IsOptionalMessage(maxLength: number): PropertyDecorator {
  return applyDecorators(
    Transform(trimToNull),
    IsOptional(),
    IsString(),
    MaxLength(maxLength),
  );
}

export class SetupDto implements SetupRequest {
  @IsNormalizedEmail()
  email: string;

  @IsNewPassword()
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(SETUP_CODE_MAX_LENGTH)
  setupCode: string;
}

export class LoginDto implements LoginRequest {
  @IsNormalizedEmail()
  email: string;

  @IsExistingPassword()
  password: string;
}

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsExistingPassword()
  currentPassword: string;

  @IsNewPassword()
  newPassword: string;
}

export class UpdateAccountDto implements UpdateAccountRequest {
  @IsNullablePersonName()
  name: string | null;
}

export class AcceptAuthTokenDto implements AcceptAuthTokenRequest {
  @IsNewPassword()
  password: string;

  @IsOptionalPersonName()
  name?: string | null;
}
