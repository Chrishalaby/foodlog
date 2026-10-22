import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_E2E_DB_NAME = 'food_test';
export const E2E_SETUP_CODE = 'test-setup-code';

const DB_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const DB_SERVER_URL = 'postgresql://food:food@localhost:5433';

export interface E2eEnvironment {
  dbName: string;
  databaseUrl: string;
  adminDatabaseUrl: string;
  tempDir: string;
  photosDir: string;
  variables: Record<string, string>;
}

export function resolveE2eDbName(value = process.env.E2E_DB_NAME): string {
  const dbName = value?.trim() || DEFAULT_E2E_DB_NAME;
  if (!DB_NAME_PATTERN.test(dbName)) {
    throw new Error(
      `E2E_DB_NAME must match ${DB_NAME_PATTERN.source}, received ${JSON.stringify(dbName)}`,
    );
  }
  return dbName;
}

export function e2eEnvironment(): E2eEnvironment {
  const dbName = resolveE2eDbName();
  const databaseUrl = `${DB_SERVER_URL}/${dbName}?schema=public`;
  const tempDir = join(tmpdir(), `foodlog-e2e-${dbName}`);
  const photosDir = join(tempDir, 'photos');
  return {
    dbName,
    databaseUrl,
    adminDatabaseUrl: `${DB_SERVER_URL}/postgres`,
    tempDir,
    photosDir,
    variables: {
      NODE_ENV: 'test',
      AI_PROVIDER: 'mock',
      SETUP_CODE: E2E_SETUP_CODE,
      STORAGE_DRIVER: 'local',
      PHOTOS_DIR: photosDir,
      DATABASE_URL: databaseUrl,
      E2E_DB_NAME: dbName,
    },
  };
}
