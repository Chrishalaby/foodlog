import { Component, computed, inject, input } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { API_LIMITS, type AiConfigDto, type AiProviderKind, type ImageDetail } from '@food/shared';
import { AuthService } from '../../../core/auth.service';
import { Icon, type IconName } from '../../../shared/ui/icon';
import { ChoiceField, type ChoiceOption } from '../controls/choice-field';
import { FieldError } from '../controls/field-error';
import { ModelPicker } from '../controls/model-picker';
import type { ProfileFormModel } from '../profile-model';
import { budgetNote, budgetStatus, formatUsd, projectMonthEndUsd, utcMonthOf } from '../usage-math';
import { AiProviderCard } from './ai-provider-card';
import { SettingsSection } from './settings-section';

interface ProviderBanner {
  icon: IconName;
  tone: string;
  title: string;
  text: string;
}

export const PROVIDER_NAMES: Readonly<Record<AiProviderKind, string>> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  local: 'your local AI server',
  custom: 'your AI server',
};

export const MOCK_BANNER: ProviderBanner = {
  icon: 'info',
  tone: 'border-accent/30 bg-accent/10 text-accent',
  title: 'Demo mode: results are simulated',
  text: 'The server uses a mock provider, so estimates are placeholders and cost nothing.',
};

export const UNCONFIGURED_BANNER: ProviderBanner = {
  icon: 'info',
  tone: 'border-accent/30 bg-accent/10 text-accent',
  title: 'AI estimates are off',
  text: 'Search, the food database, barcodes and manual entry all work without AI. To add photo, label and voice estimates, choose a provider under AI provider below and paste its API key.',
};

export const MEMBER_UNCONFIGURED_TEXT =
  "AI estimates aren't set up on this server. Search, the food database, barcodes and manual entry all work.";

export function providerBanner(
  provider: AiConfigDto['provider'],
  isAdmin: boolean,
  customEndpoint = false,
): ProviderBanner {
  if (provider === 'mock') {
    return MOCK_BANNER;
  }
  if (provider === 'unconfigured') {
    return isAdmin
      ? UNCONFIGURED_BANNER
      : { ...UNCONFIGURED_BANNER, text: MEMBER_UNCONFIGURED_TEXT };
  }
  const name =
    provider === 'openai' && customEndpoint ? PROVIDER_NAMES.custom : PROVIDER_NAMES[provider];
  return {
    icon: 'check',
    tone: 'border-ok/30 bg-ok/10 text-ok',
    title: `Connected to ${name}`,
    text: 'Photos and descriptions are analysed by the model you choose below.',
  };
}

interface AiBudgetView {
  amount: string;
  used: string | null;
  percent: number | null;
  fillPercent: number | null;
  barClass: string;
  note: string;
  noteClass: string;
}

const BUDGET_BAR_CLASSES = { ok: 'bg-brand', warn: 'bg-warn', over: 'bg-danger' } as const;

export function aiBudgetView(
  budgetUsd: number | null,
  monthToDateUsd: number | null,
  now: Date = new Date(),
): AiBudgetView {
  const used = monthToDateUsd === null ? null : formatUsd(monthToDateUsd);
  if (budgetUsd === null) {
    return {
      amount: 'No limit',
      used,
      percent: null,
      fillPercent: null,
      barClass: '',
      note: used === null ? 'Your account has no monthly AI limit.' : `${used} used this month.`,
      noteClass: 'text-muted',
    };
  }
  const amount = formatUsd(budgetUsd);
  if (budgetUsd <= 0) {
    return {
      amount,
      used,
      percent: null,
      fillPercent: null,
      barClass: '',
      note: 'AI analysis is paused for your account. Ask your admin to raise the budget.',
      noteClass: 'text-warn',
    };
  }
  const status = monthToDateUsd === null ? null : budgetStatus(monthToDateUsd, budgetUsd);
  if (!status || monthToDateUsd === null) {
    return {
      amount,
      used,
      percent: null,
      fillPercent: null,
      barClass: '',
      note: 'AI analyses pause once this month’s cost reaches your budget.',
      noteClass: 'text-muted',
    };
  }
  const projection = projectMonthEndUsd(monthToDateUsd, utcMonthOf(now), now);
  const projectedOver = projection !== null && projection > budgetUsd;
  return {
    amount,
    used,
    percent: status.percent,
    fillPercent: status.fillPercent,
    barClass: BUDGET_BAR_CLASSES[status.level],
    note: budgetNote(status, true, projectedOver),
    noteClass: status.level === 'over' ? 'text-danger' : projectedOver ? 'text-warn' : 'text-muted',
  };
}

const DETAIL_OPTIONS: readonly ChoiceOption<ImageDetail>[] = [
  { value: 'low', label: 'Low', hint: 'faster, cheaper' },
  { value: 'high', label: 'High', hint: 'more detail' },
];

@Component({
  selector: 'app-ai-section',
  imports: [SettingsSection, FormField, ModelPicker, ChoiceField, FieldError, Icon, AiProviderCard],
  template: `
    @let f = form();
    @let config = ai();
    <app-settings-section
      sectionId="settings-ai"
      heading="AI estimates"
      icon="sparkles"
      tone="accent"
      description="Choose the model and image detail used to analyse your food."
    >
      <div
        class="flex items-start gap-2.5 rounded-xl border px-3.5 py-3"
        [class]="banner().tone"
        role="status"
      >
        <app-icon class="mt-px" [name]="banner().icon" [size]="18" />
        <div class="min-w-0 text-sm leading-snug">
          <p class="font-semibold">{{ banner().title }}</p>
          <p class="mt-0.5 opacity-90">{{ banner().text }}</p>
        </div>
      </div>

      @if (isAdmin()) {
        <app-ai-provider-card />
      }

      <h3 class="label mt-4" id="ai-model-label">Model</h3>
      <app-model-picker
        labelledBy="ai-model-label"
        describedBy="ai-model-error"
        [options]="config.availableModels"
        [defaultModel]="config.defaultModel"
        [formField]="f.aiModel"
      />
      <app-field-error errorId="ai-model-error" [field]="f.aiModel" />
      <p class="mt-2 text-xs leading-relaxed text-muted">
        Costs are typical per-analysis estimates. Precise re-analysis always uses
        {{ preciseLabel() }}.
      </p>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <span class="label" id="ai-detail-food-label">Image detail · food photos</span>
          <app-choice-field
            labelledBy="ai-detail-food-label"
            [options]="detailOptions"
            [formField]="f.aiDetailFood"
          />
        </div>
        <div>
          <span class="label" id="ai-detail-label-label">Image detail · nutrition labels</span>
          <app-choice-field
            labelledBy="ai-detail-label-label"
            [options]="detailOptions"
            [formField]="f.aiDetailLabel"
          />
        </div>
      </div>
      <p class="mt-2 text-xs leading-relaxed text-muted">
        High reads more detail (small print, portion cues) and costs about 1¢ more per photo on the
        default model.
      </p>

      <div class="mt-4">
        <label class="label" for="ai-location"
          >Location <span class="font-normal">(optional)</span></label
        >
        <input
          id="ai-location"
          class="input"
          type="text"
          autocomplete="address-level2"
          enterkeyhint="done"
          placeholder="e.g. Beirut, Lebanon"
          aria-describedby="ai-location-hint ai-location-error"
          [formField]="f.location"
          [attr.aria-invalid]="f.location().touched() && f.location().invalid()"
        />
        <app-field-error errorId="ai-location-error" [field]="f.location" />
        <p id="ai-location-hint" class="mt-1.5 text-xs leading-relaxed text-muted">
          Helps the AI recognise regional dishes and typical portion sizes. Up to
          {{ locationMax }} characters.
        </p>
      </div>

      @let b = budget();
      <div class="mt-4 rounded-xl bg-surface-2 px-3.5 py-3">
        <div class="flex items-baseline justify-between gap-3 text-sm">
          <span class="font-medium text-fg" id="ai-budget-label">Your monthly AI budget</span>
          <span class="shrink-0 text-muted tabular-nums">
            @if (b.used !== null && b.percent !== null) {
              <span class="font-semibold text-fg">{{ b.used }}</span> / {{ b.amount }}
            } @else {
              <span class="font-semibold text-fg">{{ b.amount }}</span>
            }
          </span>
        </div>
        @if (b.fillPercent !== null) {
          <div
            class="mt-1.5 h-2 overflow-hidden rounded-full bg-surface"
            role="progressbar"
            aria-labelledby="ai-budget-label"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="b.percent"
            [attr.aria-valuetext]="b.used + ' of ' + b.amount"
          >
            <div
              class="h-full rounded-full transition-[width] duration-500"
              [class]="b.barClass"
              [style.width.%]="b.fillPercent"
            ></div>
          </div>
        }
        <p class="mt-1 text-xs" [class]="b.noteClass">{{ b.note }}</p>
      </div>

      <div class="mt-4 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-fg">Reasoning effort</p>
          <p class="text-xs text-muted">Set on the server</p>
        </div>
        <span class="chip bg-surface text-fg capitalize">{{ config.reasoningEffort }}</span>
      </div>
    </app-settings-section>
  `,
})
export class AiSection {
  readonly form = input.required<FieldTree<ProfileFormModel>>();
  readonly ai = input.required<AiConfigDto>();
  readonly monthToDateUsd = input<number | null>(null);

  protected readonly detailOptions = DETAIL_OPTIONS;
  protected readonly locationMax = API_LIMITS.locationMax;
  protected readonly isAdmin = inject(AuthService).isAdmin;

  protected readonly banner = computed(() =>
    providerBanner(this.ai().provider, this.isAdmin(), this.ai().customEndpoint),
  );
  protected readonly budget = computed(() =>
    aiBudgetView(this.ai().monthlyBudgetUsd, this.monthToDateUsd()),
  );
  protected readonly preciseLabel = computed(() => {
    const config = this.ai();
    return (
      config.availableModels.find((model) => model.id === config.preciseModel)?.label ??
      config.preciseModel
    );
  });
}
