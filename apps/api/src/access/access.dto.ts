import {
  API_LIMITS,
  type AcceptAccessRequest,
  type AccessRequestStatusRequest,
  type CreateAccessRequest,
} from '@food/shared';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  IsNewPassword,
  IsNormalizedEmail,
  IsOptionalMessage,
  IsPersonName,
} from '../auth/auth.dto.js';

const STATUS_TOKEN_MAX_LENGTH = 128;
const HONEYPOT_MAX_LENGTH = 500;

export class CreateAccessRequestDto implements CreateAccessRequest {
  @IsNormalizedEmail()
  email: string;

  @IsPersonName()
  name: string;

  @IsOptionalMessage(API_LIMITS.accessMessageMax)
  message?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(HONEYPOT_MAX_LENGTH)
  website?: string;
}

export class AccessRequestStatusDto implements AccessRequestStatusRequest {
  @IsString()
  @MaxLength(STATUS_TOKEN_MAX_LENGTH)
  statusToken: string;
}

export class AcceptAccessRequestDto implements AcceptAccessRequest {
  @IsString()
  @MaxLength(STATUS_TOKEN_MAX_LENGTH)
  statusToken: string;

  @IsNewPassword()
  password: string;
}
