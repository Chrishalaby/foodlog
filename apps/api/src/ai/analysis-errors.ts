import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  AiFailureKind,
  AiProviderError,
} from './providers/ai-provider-error.js';

export const AI_NOT_CONFIGURED_MESSAGE =
  'AI is not configured — an admin can add a provider in Settings → AI';
export const BUDGET_REACHED_MESSAGE = 'Monthly AI budget reached';

export function tooManyRequests(message: string): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message,
      error: 'Too Many Requests',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

const BAD_GATEWAY_MESSAGES: Record<
  Exclude<
    AiFailureKind,
    'quota_exceeded' | 'auth' | 'rate_limited' | 'timeout'
  >,
  string
> = {
  refusal:
    'The AI declined to analyze this — try another photo or add a description',
  incomplete: 'The AI response was cut short — please try again',
  invalid_output: 'The AI returned an unreadable answer — please try again',
  server_error:
    'OpenAI is having problems right now — please try again shortly',
  connection: 'Could not reach OpenAI — please try again',
  bad_request: 'OpenAI rejected the analysis request',
  unknown: 'The AI analysis failed — please try again',
};

export function toAnalyzeHttpException(error: AiProviderError): HttpException {
  switch (error.kind) {
    case 'quota_exceeded':
      return new ServiceUnavailableException(
        'OpenAI quota or billing limit reached',
      );
    case 'auth':
      return new ServiceUnavailableException('OpenAI rejected the API key');
    case 'rate_limited':
      return tooManyRequests(
        'OpenAI is rate limiting requests — try again in a minute',
      );
    case 'timeout':
      return new GatewayTimeoutException(
        'The AI took too long to respond — please try again',
      );
    default:
      return new BadGatewayException(BAD_GATEWAY_MESSAGES[error.kind]);
  }
}
