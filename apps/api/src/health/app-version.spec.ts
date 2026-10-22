import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAppVersion } from './app-version.js';

const FULL_SHA = 'ABC1234DEF5678ABC1234DEF5678ABC1234DEF56';

describe('readAppVersion', () => {
  let dir: string;
  let packageJson: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'foodlog-version-'));
    packageJson = join(dir, 'package.json');
    await writeFile(packageJson, JSON.stringify({ version: '1.2.3' }));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('adds the short deployed commit to the package version', () => {
    expect(
      readAppVersion({ RAILWAY_GIT_COMMIT_SHA: FULL_SHA }, packageJson),
    ).toBe('1.2.3+abc1234');
  });

  it.each([
    ['no commit', {}],
    ['an empty commit', { RAILWAY_GIT_COMMIT_SHA: '' }],
    ['a blank commit', { RAILWAY_GIT_COMMIT_SHA: '   ' }],
    ['a branch name', { RAILWAY_GIT_COMMIT_SHA: 'main' }],
    ['a value that is not hex', { RAILWAY_GIT_COMMIT_SHA: 'abc123z' }],
  ])('keeps the package version for %s', (_label, env) => {
    expect(readAppVersion(env, packageJson)).toBe('1.2.3');
  });

  it('reports only the commit when the package version is unreadable', () => {
    expect(
      readAppVersion(
        { RAILWAY_GIT_COMMIT_SHA: FULL_SHA },
        join(dir, 'missing.json'),
      ),
    ).toBe('abc1234');
  });

  it('reports unknown without a commit or a package version', async () => {
    await writeFile(packageJson, JSON.stringify({ version: 1 }));

    expect(readAppVersion({}, packageJson)).toBe('unknown');
  });
});
