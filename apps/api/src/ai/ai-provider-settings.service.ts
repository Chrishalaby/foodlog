import {
  AI_PROVIDER_PRESETS,
  type AiProviderResponse,
  type TestAiProviderResponse,
  type UpdateAiProviderRequest,
} from '@food/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SecretsService } from '../secrets/secrets.service.js';
import { testAiConnection } from './ai-connection-test.js';
import {
  aiProviderProblems,
  isAiApiStyle,
  isAiProviderKind,
  keyLast4,
  mergeAiProviderRequest,
  type SavedAiProviderMeta,
  toServerDto,
  toSettingsDto,
} from './ai-provider-settings.js';
import {
  appConnection,
  isEnvManaged,
  resolveRuntimeAiSettings,
  type RuntimeAiSettings,
  type StoredAiProvider,
} from './ai-runtime-settings.js';

export const AI_SETTINGS_ID = 'default';
export const API_KEY_PURPOSE = 'ai-provider.api-key';
export const TRANSCRIBE_KEY_PURPOSE = 'ai-provider.transcribe-api-key';
export const DEMO_AI_SETTINGS_MESSAGE =
  'The demo uses simulated AI, so the provider cannot be changed';
export const ENV_AI_SETTINGS_MESSAGE =
  'AI is set on the server (OPENAI_API_KEY or AI_PROVIDER), so it cannot be changed here';

interface SavedAiProvider {
  stored: StoredAiProvider;
  meta: SavedAiProviderMeta;
  keyUnreadable: boolean;
}

@Injectable()
export class AiProviderSettingsService implements OnModuleInit {
  private readonly logger = new Logger(AiProviderSettingsService.name);
  private saved: SavedAiProvider | null = null;
  private current: RuntimeAiSettings;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly secrets: SecretsService,
  ) {
    this.current = resolveRuntimeAiSettings(config, null);
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  snapshot(): RuntimeAiSettings {
    return this.current;
  }

  async refresh(): Promise<RuntimeAiSettings> {
    this.saved = await this.load();
    this.current = resolveRuntimeAiSettings(
      this.config,
      this.saved?.stored ?? null,
    );
    return this.current;
  }

  describe(): AiProviderResponse {
    const { source, ai, voice } = this.current;
    const active = ai.provider !== 'unconfigured';
    return {
      source,
      editable: !isEnvManaged(this.config),
      active,
      voice: active && (ai.provider === 'mock' || voice.enabled),
      keyUnreadable: this.saved?.keyUnreadable ?? false,
      settings: this.saved
        ? toSettingsDto(this.saved.stored, this.saved.meta)
        : null,
      server:
        source === 'env' || source === 'demo' ? toServerDto(this.config) : null,
    };
  }

  async save(
    actorId: string,
    request: UpdateAiProviderRequest,
  ): Promise<AiProviderResponse> {
    this.assertEditable();
    await this.refresh();
    const candidate = this.candidate(request);
    const [apiKeySealed, transcribeApiKeySealed] = await Promise.all([
      this.seal(candidate.apiKey, API_KEY_PURPOSE),
      this.seal(candidate.transcribeApiKey, TRANSCRIBE_KEY_PURPOSE),
    ]);
    const data = {
      provider: candidate.provider,
      baseUrl: candidate.baseUrl,
      apiStyle: candidate.apiStyle,
      model: candidate.model,
      preciseModel: candidate.preciseModel,
      apiKeySealed,
      apiKeyLast4: keyLast4(candidate.apiKey),
      voiceEnabled: candidate.voiceEnabled,
      transcribeBaseUrl: candidate.transcribeBaseUrl,
      transcribeModel: candidate.transcribeModel,
      transcribeApiKeySealed,
      transcribeApiKeyLast4: keyLast4(candidate.transcribeApiKey),
      updatedById: actorId,
    };
    await this.prisma.aiProviderConfig.upsert({
      where: { id: AI_SETTINGS_ID },
      create: { id: AI_SETTINGS_ID, ...data },
      update: data,
    });
    await this.refresh();
    return this.describe();
  }

  async remove(): Promise<AiProviderResponse> {
    this.assertEditable();
    await this.prisma.aiProviderConfig.deleteMany({
      where: { id: AI_SETTINGS_ID },
    });
    await this.refresh();
    return this.describe();
  }

  async test(
    request: UpdateAiProviderRequest,
  ): Promise<TestAiProviderResponse> {
    this.assertEditable();
    await this.refresh();
    return testAiConnection(
      appConnection(this.candidate(request)),
      this.config,
    );
  }

  private candidate(request: UpdateAiProviderRequest): StoredAiProvider {
    const candidate = mergeAiProviderRequest(
      request,
      this.saved?.stored ?? null,
    );
    const problems = aiProviderProblems(candidate);
    if (problems.length > 0) {
      throw new BadRequestException(problems);
    }
    return candidate;
  }

  private assertEditable(): void {
    if (this.config.demo.enabled) {
      throw new ForbiddenException(DEMO_AI_SETTINGS_MESSAGE);
    }
    if (isEnvManaged(this.config)) {
      throw new ConflictException(ENV_AI_SETTINGS_MESSAGE);
    }
  }

  private seal(value: string | null, purpose: string): Promise<string | null> {
    return value === null
      ? Promise.resolve(null)
      : this.secrets.seal(value, purpose);
  }

  private open(sealed: string | null, purpose: string): Promise<string | null> {
    return sealed === null
      ? Promise.resolve(null)
      : this.secrets.open(sealed, purpose);
  }

  private async load(): Promise<SavedAiProvider | null> {
    let row;
    try {
      row = await this.prisma.aiProviderConfig.findUnique({
        where: { id: AI_SETTINGS_ID },
      });
    } catch (error) {
      this.logger.warn(
        `Could not load the AI provider settings: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
    if (!row || !isAiProviderKind(row.provider)) {
      return null;
    }
    const [apiKey, transcribeApiKey] = await Promise.all([
      this.open(row.apiKeySealed, API_KEY_PURPOSE),
      this.open(row.transcribeApiKeySealed, TRANSCRIBE_KEY_PURPOSE),
    ]);
    const keyUnreadable =
      (row.apiKeySealed !== null && apiKey === null) ||
      (row.transcribeApiKeySealed !== null && transcribeApiKey === null);
    if (keyUnreadable) {
      this.logger.warn(
        'A saved AI key could not be decrypted. If SECRETS_KEY changed, enter the key again in Settings → AI.',
      );
    }
    return {
      stored: {
        provider: row.provider,
        baseUrl: row.baseUrl,
        apiStyle: isAiApiStyle(row.apiStyle)
          ? row.apiStyle
          : AI_PROVIDER_PRESETS[row.provider].apiStyle,
        model: row.model,
        preciseModel: row.preciseModel,
        apiKey,
        voiceEnabled: row.voiceEnabled,
        transcribeBaseUrl: row.transcribeBaseUrl,
        transcribeModel: row.transcribeModel,
        transcribeApiKey,
      },
      meta: {
        apiKeyLast4: row.apiKeyLast4,
        transcribeApiKeyLast4: row.transcribeApiKeyLast4,
        updatedAt: row.updatedAt,
      },
      keyUnreadable,
    };
  }
}
