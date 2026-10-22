import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type EnvRecord, loadEnvFiles } from '../config/env-files.js';

const PACKAGE_JSON_PATH = resolve(import.meta.dirname, '../../package.json');
const COMMIT_SHA = /^[0-9a-f]{7,40}$/;
const SHORT_SHA_LENGTH = 7;
const UNKNOWN_VERSION = 'unknown';

function readPackageVersion(path: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const version =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed
        ? parsed.version
        : undefined;
    return typeof version === 'string' ? version : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}

function shortCommit(value: string | undefined): string | null {
  const sha = value?.trim().toLowerCase() ?? '';
  return COMMIT_SHA.test(sha) ? sha.slice(0, SHORT_SHA_LENGTH) : null;
}

export function readAppVersion(
  env: EnvRecord = loadEnvFiles(),
  path = PACKAGE_JSON_PATH,
): string {
  const version = readPackageVersion(path);
  const commit = shortCommit(env['RAILWAY_GIT_COMMIT_SHA']);
  if (commit === null) {
    return version;
  }
  return version === UNKNOWN_VERSION ? commit : `${version}+${commit}`;
}
