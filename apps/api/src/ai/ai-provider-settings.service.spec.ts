import { ConflictException, ForbiddenException } from '@nestjs/common';
import { buildConfig } from '../../test/support/config.js';
import type { EnvRecord } from '../config/env-files.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SecretsService } from '../secrets/secrets.service.js';
import {
  AI_SETTINGS_ID,
  AiProviderSettingsService,
} from './ai-provider-settings.service.js';
import { RuntimeAiProvider } from './providers/runtime-ai-provider.js';

type Row = Record<string, unknown> & { id: string; updatedAt: Date };

const CLAUDE_KEY = 'sk-ant-fake-key-00001a2b';

function createPrismaMock() {
  let row: Row | null = null;
  const secrets = new Map<string, string>();
  const prisma = {
    aiProviderConfig: {
      findUnique: vi.fn(() => Promise.resolve(row)),
      upsert: vi.fn(
        ({ create, update }: { create: Row; update: Partial<Row> }) => {
          row = row
            ? { ...row, ...update, updatedAt: new Date() }
            : { ...create, updatedAt: new Date() };
          return Promise.resolve(row);
        },
      ),
      deleteMany: vi.fn(() => {
        row = null;
        return Promise.resolve({ count: 1 });
      }),
    },
    appSecret: {
      findUnique: vi.fn(({ where }: { where: { key: string } }) => {
        const value = secrets.get(where.key);
        return Promise.resolve(value === undefined ? null : { value });
      }),
      createMany: vi.fn(
        ({ data }: { data: { key: string; value: string } }) => {
          if (!secrets.has(data.key)) {
            secrets.set(data.key, data.value);
          }
          return Promise.resolve({ count: 1 });
        },
      ),
    },
  };
  return {
    prisma: prisma as unknown as PrismaService,
    row: () => row,
  };
}

async function serviceFor(env: EnvRecord = {}) {
  const mock = createPrismaMock();
  const config = buildConfig(env);
  const service = new AiProviderSettingsService(
    mock.prisma,
    config,
    new SecretsService(mock.prisma, config),
  );
  await service.onModuleInit();
  return { service, mock, config };
}

const CLAUDE_REQUEST = {
  provider: 'anthropic' as const,
  model: 'claude-sonnet-5-5',
  preciseModel: 'claude-opus-5-5',
  apiKey: CLAUDE_KEY,
  voiceEnabled: true,
};

describe('AiProviderSettingsService', () => {
  it('starts unconfigured and editable', async () => {
    const { service } = await serviceFor();
    expect(service.describe()).toEqual({
      source: 'none',
      editable: true,
      active: false,
      voice: false,
      keyUnreadable: false,
      settings: null,
      server: null,
    });
  });

  it('stores the key encrypted and switches AI on without a restart', async () => {
    const { service, mock, config } = await serviceFor();
    const runtime = new RuntimeAiProvider(service, config);
    expect(runtime.name).toBe('openai');

    const response = await service.save('admin-id', CLAUDE_REQUEST);

    const row = mock.row();
    expect(row?.id).toBe(AI_SETTINGS_ID);
    expect(String(row?.apiKeySealed)).toMatch(/^v1:db:/);
    expect(JSON.stringify(row)).not.toContain(CLAUDE_KEY);
    expect(row?.apiKeyLast4).toBe('1a2b');
    expect(row?.updatedById).toBe('admin-id');
    expect(response).toMatchObject({
      source: 'app',
      active: true,
      voice: false,
      settings: { provider: 'anthropic', hasApiKey: true, apiKeyLast4: '1a2b' },
    });
    expect(JSON.stringify(response)).not.toContain(CLAUDE_KEY);
    expect(service.snapshot().ai).toMatchObject({
      provider: 'anthropic',
      apiKey: CLAUDE_KEY,
    });
    expect(runtime.name).toBe('anthropic');
  });

  it('keeps the saved key when the form is saved without a new one', async () => {
    const { service } = await serviceFor();
    await service.save('admin-id', CLAUDE_REQUEST);

    await service.save('admin-id', {
      ...CLAUDE_REQUEST,
      apiKey: undefined,
      model: 'claude-haiku-5-5',
    });

    expect(service.snapshot().ai).toMatchObject({
      apiKey: CLAUDE_KEY,
      model: 'claude-haiku-5-5',
    });
  });

  it('turns AI off again when the provider is removed', async () => {
    const { service, mock } = await serviceFor();
    await service.save('admin-id', CLAUDE_REQUEST);

    const response = await service.remove();

    expect(mock.row()).toBeNull();
    expect(response).toMatchObject({ source: 'none', active: false });
    expect(service.snapshot().ai.provider).toBe('unconfigured');
  });

  it('rejects a provider without its required key', async () => {
    const { service } = await serviceFor();
    await expect(
      service.save('admin-id', { ...CLAUDE_REQUEST, apiKey: null }),
    ).rejects.toMatchObject({
      response: { message: ['apiKey is required for Anthropic (Claude)'] },
    });
  });

  it('shows server settings read-only when the environment sets AI', async () => {
    const { service } = await serviceFor({ OPENAI_API_KEY: 'sk-env-key' });

    expect(service.describe()).toMatchObject({
      source: 'env',
      editable: false,
      active: true,
      server: { provider: 'openai', model: 'gpt-5.6-sol' },
    });
    expect(JSON.stringify(service.describe())).not.toContain('sk-env-key');
    await expect(
      service.save('admin-id', CLAUDE_REQUEST),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.test(CLAUDE_REQUEST)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('keeps the demo on simulated AI', async () => {
    const { service } = await serviceFor({ DEMO_MODE: 'true' });

    expect(service.describe()).toMatchObject({
      source: 'demo',
      editable: false,
      server: { provider: 'mock' },
    });
    await expect(service.remove()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('flags a saved key that can no longer be decrypted', async () => {
    const env = { SECRETS_KEY: 'x'.repeat(40) };
    const first = await serviceFor(env);
    await first.service.save('admin-id', CLAUDE_REQUEST);
    const row = first.mock.row();

    const rotated = createPrismaMock();
    const config = buildConfig({ SECRETS_KEY: 'y'.repeat(40) });
    (
      rotated.prisma.aiProviderConfig.findUnique as unknown as {
        mockResolvedValue: (value: unknown) => void;
      }
    ).mockResolvedValue(row);
    const service = new AiProviderSettingsService(
      rotated.prisma,
      config,
      new SecretsService(rotated.prisma, config),
    );
    await service.onModuleInit();

    expect(service.describe()).toMatchObject({
      keyUnreadable: true,
      active: false,
      settings: { hasApiKey: false, apiKeyLast4: null },
    });
  });
});
