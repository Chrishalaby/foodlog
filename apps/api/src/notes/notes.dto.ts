import {
  API_LIMITS,
  type CreateNoteFields,
  NOTE_STATUSES,
  type NoteListQuery,
  type NoteStatus,
  type UpdateNoteRequest,
} from '@food/shared';
import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../common/dto.js';
import { ENTRY_CURSOR_MAX_LENGTH } from '../entries/entry-cursor.js';
import { HasNoNullCharacter } from '../entries/entry-validation.js';

function WhenPresent(): PropertyDecorator {
  return ValidateIf((_dto: object, value: unknown) => value !== undefined);
}

function IsNoteText(): PropertyDecorator {
  return applyDecorators(
    WhenPresent(),
    Trim(),
    IsString(),
    MaxLength(API_LIMITS.noteTextMax),
    HasNoNullCharacter(),
  );
}

export class NoteListQueryDto implements NoteListQuery {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(API_LIMITS.foodQueryMax)
  q?: string;

  @IsOptional()
  @IsIn(NOTE_STATUSES)
  status?: NoteStatus;

  @IsOptional()
  @IsString()
  @MaxLength(ENTRY_CURSOR_MAX_LENGTH)
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_LIMITS.notesPageMax)
  limit?: number;
}

export class CreateNoteDto implements CreateNoteFields {
  @IsNoteText()
  text?: string;
}

export class UpdateNoteDto implements UpdateNoteRequest {
  @IsNoteText()
  text?: string;

  @WhenPresent()
  @IsBoolean()
  done?: boolean;
}
