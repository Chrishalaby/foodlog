import { AppConfig } from '../../src/config/app-config.js';
import type { EnvRecord } from '../../src/config/env-files.js';
import { parseSettings } from '../../src/config/settings.js';

export const TEST_DATABASE_URL =
  'postgresql://food:food@localhost:5433/food_unit?schema=public';

export function buildConfig(env: EnvRecord = {}): AppConfig {
  return new AppConfig(
    parseSettings({ DATABASE_URL: TEST_DATABASE_URL, ...env }),
  );
}
