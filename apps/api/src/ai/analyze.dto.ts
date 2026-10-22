import {
  ANALYSIS_MODES,
  type AnalysisMode,
  API_LIMITS,
  IMAGE_DETAILS,
  IMAGE_ROLES,
  type ImageDetail,
  isValidLocalDate,
  MEAL_TYPES,
  type MealType,
} from '@food/shared';
import {
  buildMessage,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';
import { Trim } from '../common/dto.js';
import type { AnalyzeRequest } from './analysis-plan.js';
import { parseImageRoles } from './analyze-uploads.js';
import { FOLLOW_UP_KINDS, type FollowUpKind } from './prompt.js';

const LOCAL_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;

export function isLocalTime(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = LOCAL_TIME_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const [, date, hours, minutes] = match;
  return (
    isValidLocalDate(date) &&
    Number(hours) <= MAX_HOUR &&
    Number(minutes) <= MAX_MINUTE
  );
}

export function IsLocalTime(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isLocalTime',
      validator: {
        validate: (value: unknown): boolean => isLocalTime(value),
        defaultMessage: buildMessage(
          (each) =>
            `${each}$property must be a local time formatted as YYYY-MM-DDTHH:mm`,
          options,
        ),
      },
    },
    options,
  );
}

export function IsImageRoleList(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isImageRoleList',
      validator: {
        validate: (value: unknown): boolean => parseImageRoles(value) !== null,
        defaultMessage: buildMessage(
          (each) =>
            `${each}$property must be a comma-separated list of ${IMAGE_ROLES.join(' or ')}`,
          options,
        ),
      },
    },
    options,
  );
}

export class AnalyzeRequestDto implements AnalyzeRequest {
  @IsIn(ANALYSIS_MODES)
  mode: AnalysisMode;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(API_LIMITS.descriptionMax)
  description?: string;

  @IsOptional()
  @IsIn(IMAGE_DETAILS)
  detail?: ImageDetail;

  @IsOptional()
  @IsIn(['true', 'false'])
  precise?: 'true' | 'false';

  @IsOptional()
  @IsUUID()
  previousAnalysisId?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(API_LIMITS.followUpAnswerMax)
  followUpAnswer?: string;

  @IsOptional()
  @IsIn(FOLLOW_UP_KINDS)
  followUpKind?: FollowUpKind;

  @IsOptional()
  @IsLocalTime()
  localTime?: string;

  @IsOptional()
  @IsIn(MEAL_TYPES)
  mealType?: MealType;

  @IsOptional()
  @IsImageRoleList()
  imageRoles?: string;

  @IsOptional()
  @IsUUID()
  draftId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  split?: 'true' | 'false';
}
