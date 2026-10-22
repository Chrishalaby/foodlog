import { loadEnvFiles } from './env-files.js';
import { type AiRateLimits, parseAiRateLimits } from './settings.js';

export function aiRateLimits(): AiRateLimits {
  return parseAiRateLimits(loadEnvFiles());
}
