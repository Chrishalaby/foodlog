import type { AiApiStyle, AiProviderKind } from './enums.js';

export type TranscriptionEndpoint = 'same' | 'separate';

export interface AiProviderPreset {
  kind: AiProviderKind;
  label: string;
  description: string;
  baseUrl: string | null;
  baseUrlEditable: boolean;
  apiStyle: AiApiStyle;
  apiStyleEditable: boolean;
  keyRequired: boolean;
  keyPlaceholder: string;
  model: string;
  preciseModel: string;
  models: readonly string[];
  transcription: TranscriptionEndpoint;
}

export const AI_PROVIDER_LIMITS = {
  baseUrlMax: 500,
  modelMax: 200,
  apiKeyMax: 500,
} as const;

export const AI_PROVIDER_PRESETS: Readonly<Record<AiProviderKind, AiProviderPreset>> = {
  openai: {
    kind: 'openai',
    label: 'OpenAI',
    description: 'GPT models with your OpenAI API key.',
    baseUrl: null,
    baseUrlEditable: false,
    apiStyle: 'responses',
    apiStyleEditable: false,
    keyRequired: true,
    keyPlaceholder: 'sk-…',
    model: 'gpt-5.6-sol',
    preciseModel: 'gpt-6-astra',
    models: ['gpt-5.6-sol', 'gpt-6-sol', 'gpt-6-astra', 'gpt-5.6-luna', 'gpt-6-luna'],
    transcription: 'same',
  },
  anthropic: {
    kind: 'anthropic',
    label: 'Anthropic (Claude)',
    description: 'Claude models with your Anthropic API key.',
    baseUrl: null,
    baseUrlEditable: false,
    apiStyle: 'chat',
    apiStyleEditable: false,
    keyRequired: true,
    keyPlaceholder: 'sk-ant-…',
    model: 'claude-sonnet-5-5',
    preciseModel: 'claude-opus-5-5',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
    transcription: 'separate',
  },
  gemini: {
    kind: 'gemini',
    label: 'Google Gemini',
    description: 'Gemini models with your Google AI Studio key.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    baseUrlEditable: false,
    apiStyle: 'chat',
    apiStyleEditable: false,
    keyRequired: true,
    keyPlaceholder: 'AIza…',
    model: 'gemini-3.8-flash',
    preciseModel: 'gemini-4-argon',
    models: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.5-flash-lite'],
    transcription: 'separate',
  },
  openrouter: {
    kind: 'openrouter',
    label: 'OpenRouter',
    description: 'Models from many companies with one OpenRouter key.',
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEditable: true,
    apiStyle: 'chat',
    apiStyleEditable: false,
    keyRequired: true,
    keyPlaceholder: 'sk-or-…',
    model: 'google/gemini-3.8-flash',
    preciseModel: 'anthropic/claude-opus-5.5',
    models: ['google/gemini-3.8-flash', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5'],
    transcription: 'separate',
  },
  local: {
    kind: 'local',
    label: 'Ollama or LM Studio',
    description: 'A vision model running on your own computer. Small local models are much less accurate.',
    baseUrl: 'http://localhost:11434/v1',
    baseUrlEditable: true,
    apiStyle: 'chat',
    apiStyleEditable: false,
    keyRequired: false,
    keyPlaceholder: 'Not needed',
    model: 'qwen3-vl:8b',
    preciseModel: 'qwen3-vl:32b',
    models: ['qwen3-vl:8b', 'qwen3-vl:32b', 'gemma4:e4b', 'gemma4:26b'],
    transcription: 'separate',
  },
  custom: {
    kind: 'custom',
    label: 'Other OpenAI-compatible server',
    description: 'Any server that speaks the OpenAI API, such as vLLM or LiteLLM.',
    baseUrl: null,
    baseUrlEditable: true,
    apiStyle: 'chat',
    apiStyleEditable: true,
    keyRequired: false,
    keyPlaceholder: 'Optional',
    model: '',
    preciseModel: '',
    models: [],
    transcription: 'same',
  },
};
