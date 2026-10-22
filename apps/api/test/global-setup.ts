import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { e2eEnvironment } from './e2e-environment.js';

const run = promisify(execFile);
const API_ROOT = resolve(import.meta.dirname, '..');
const DUPLICATE_DATABASE = '42P04';

function isDuplicateDatabaseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === DUPLICATE_DATABASE
  );
}

async function ensureDatabase(adminUrl: string, dbName: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (existing.rowCount === 0) {
      await client
        .query(`CREATE DATABASE "${dbName}"`)
        .catch((error: unknown) => {
          if (!isDuplicateDatabaseError(error)) {
            throw error;
          }
        });
    }
  } finally {
    await client.end();
  }
}

async function migrate(databaseUrl: string): Promise<void> {
  try {
    await run('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], {
      cwd: API_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
    });
  } catch (error) {
    const output =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr)
        : '';
    throw new Error(
      `prisma migrate deploy failed for ${databaseUrl}\n${output}`,
      {
        cause: error,
      },
    );
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const env = e2eEnvironment();
  await ensureDatabase(env.adminDatabaseUrl, env.dbName);
  await migrate(env.databaseUrl);
  await rm(env.tempDir, { recursive: true, force: true });
  return async () => {
    await rm(env.tempDir, { recursive: true, force: true });
  };
}
