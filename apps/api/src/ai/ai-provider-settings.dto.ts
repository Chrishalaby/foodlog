import {
  AI_API_STYLES,
  AI_PROVIDER_KINDS,
  AI_PROVIDER_LIMITS,
  type AiApiStyle,
  type AiProviderKind,
  type UpdateAiProviderRequest,
} from '@food/shared';
import {
  buildMessage,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateBy,
} from 'class-validator';
import { Trim } from '../common/dto.js';

export function isHttpBaseUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const url = URL.parse(value.trim());
  return (
    url !== null &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.hostname !== '' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''
  );
}

function IsHttpBaseUrl(): PropertyDecorator {
  return ValidateBy({
    name: 'isHttpBaseUrl',
    validator: {
      validate: (value: unknown) => value === '' || isHttpBaseUrl(value),
      defaultMessage: buildMessage(
        (each) =>
          `${each}$property must be an http(s) URL without credentials, a query or a fragment`,
      ),
    },
  });
}

export class UpdateAiProviderDto implements UpdateAiProviderRequest {
  @IsIn(AI_PROVIDER_KINDS)
  provider: AiProviderKind;

  @IsOptional()
  @Trim()
  @MaxLength(AI_PROVIDER_LIMITS.baseUrlMax)
  @IsHttpBaseUrl()
  baseUrl?: string | null;

  @IsOptional()
  @IsIn(AI_API_STYLES)
  apiStyle?: AiApiStyle;

  @IsString()
  @Trim()
  @MaxLength(AI_PROVIDER_LIMITS.modelMax)
  model: string;

  @IsString()
  @Trim()
  @MaxLength(AI_PROVIDER_LIMITS.modelMax)
  preciseModel: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_PROVIDER_LIMITS.apiKeyMax)
  apiKey?: string | null;

  @IsBoolean()
  voiceEnabled: boolean;

  @IsOptional()
  @Trim()
  @MaxLength(AI_PROVIDER_LIMITS.baseUrlMax)
  @IsHttpBaseUrl()
  transcribeBaseUrl?: string | null;

  @IsOptional()
  @IsString()
  @Trim()
  @MaxLength(AI_PROVIDER_LIMITS.modelMax)
  transcribeModel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(AI_PROVIDER_LIMITS.apiKeyMax)
  transcribeApiKey?: string | null;
}
