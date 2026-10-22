import { API_LIMITS } from '@food/shared';
import { applyDecorators } from '@nestjs/common';
import {
  buildMessage,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateBy,
} from 'class-validator';
import { IsEntryItems, IsIsoTimestamp, Trim } from '../common/dto.js';
import { isStorableTime } from './storable-time.js';

const NULL_CHARACTER = '\u0000';

export function hasNoNullCharacter(value: unknown): boolean {
  return typeof value !== 'string' || !value.includes(NULL_CHARACTER);
}

export function hasNoNullCharacterInItemNames(value: unknown): boolean {
  return (
    !Array.isArray(value) ||
    value.every(
      (item: unknown) =>
        typeof item !== 'object' ||
        item === null ||
        hasNoNullCharacter((item as { name?: unknown }).name),
    )
  );
}

export function isStorableTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') {
    return true;
  }
  const millis = Date.parse(value);
  return Number.isNaN(millis) || isStorableTime(millis);
}

export function HasNoNullCharacter(): PropertyDecorator {
  return ValidateBy({
    name: 'hasNoNullCharacter',
    validator: {
      validate: hasNoNullCharacter,
      defaultMessage: buildMessage(
        (each) => `${each}$property must not contain null characters`,
      ),
    },
  });
}

function HasNoNullCharacterInItemNames(): PropertyDecorator {
  return ValidateBy({
    name: 'hasNoNullCharacterInItemNames',
    validator: {
      validate: hasNoNullCharacterInItemNames,
      defaultMessage: buildMessage(
        (each) => `${each}$property must not contain null characters in names`,
      ),
    },
  });
}

function IsStorableTimestamp(): PropertyDecorator {
  return ValidateBy({
    name: 'isStorableTimestamp',
    validator: {
      validate: isStorableTimestamp,
      defaultMessage: buildMessage(
        (each) => `${each}$property must be between the years 0001 and 9999`,
      ),
    },
  });
}

export function IsEntryName(): PropertyDecorator {
  return applyDecorators(
    Trim(),
    IsString(),
    Length(1, API_LIMITS.nameMax),
    HasNoNullCharacter(),
  );
}

export function IsOptionalEntryDescription(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Trim(),
    IsString(),
    MaxLength(API_LIMITS.descriptionMax),
    HasNoNullCharacter(),
  );
}

export function IsOptionalSearchTerm(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Trim(),
    IsString(),
    MaxLength(API_LIMITS.nameMax),
    HasNoNullCharacter(),
  );
}

export function IsEntryTimestamp(): PropertyDecorator {
  return applyDecorators(IsIsoTimestamp(), IsStorableTimestamp());
}

export function IsEntryItemList(): PropertyDecorator {
  return applyDecorators(IsEntryItems(), HasNoNullCharacterInItemNames());
}

export function IsOptionalUuid(): PropertyDecorator {
  return applyDecorators(IsOptional(), IsUUID());
}
