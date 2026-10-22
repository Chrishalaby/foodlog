import { config } from 'dotenv';

export const ENV_FILE_PATHS = ['.env', '../../.env'];

export type EnvRecord = Record<string, string | undefined>;

let envFilesLoaded = false;

export function loadEnvFiles(): EnvRecord {
  if (!envFilesLoaded) {
    config({ path: ENV_FILE_PATHS, quiet: true });
    envFilesLoaded = true;
  }
  return process.env;
}
