import {
  Component,
  type ResourceRef,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import type { UsageRecordDto, UsageSummaryResponse } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { errorMessage } from '../../../core/errors';
import { localDateOf, relativeDayLabel, toTimeLabel } from '../../../core/time';
import { Icon } from '../../../shared/ui/icon';
import { Skeleton } from '../../../shared/ui/skeleton';
import { formatNumber } from '../../../shared/utils/format';
import {
  USAGE_MODE_LABELS,
  budgetNote,
  budgetStatus,
  formatDuration,
  formatTokenCount,
  formatUsd,
  modelBreakdown,
  monthLabel,
  projectMonthEndUsd,
  recentUtcMonths,
  utcMonthOf,
} from '../usage-math';
import { SettingsSection } from './settings-section';

export const USAGE_MONTHS_SHOWN = 12;

interface UsageStat {
  label: string;
  value: string;
  hint: string;
}

interface UsageRecordRow {
  id: string;
  model: string;
  mode: string;
  when: string;
  tokens: string;
  duration: string;
  cost: string;
  success: boolean;
  error: string | null;
}

const BUDGET_BAR_CLASSES = { ok: 'bg-brand', warn: 'bg-warn', over: 'bg-danger' } as const;

function recordWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${relativeDayLabel(localDateOf(date))} ${toTimeLabel(iso)}`;
}

@Component({
  selector: 'app-usage-section',
  imports: [SettingsSection, Icon, Skeleton],
  templateUrl: './usage-section.html',
})
export class UsageSection {
  private readonly api = inject(ApiService);

  readonly modelLabels = input<ReadonlyMap<string, string>>(new Map());
  readonly currentMonth = input<ResourceRef<UsageSummaryResponse | undefined> | null>(null);

  protected readonly months = recentUtcMonths(new Date(), USAGE_MONTHS_SHOWN).map((value) => ({
    value,
    label: monthLabel(value),
  }));
  protected readonly month = signal(utcMonthOf(new Date()));
  protected readonly isCurrentMonth = computed(() => this.month() === utcMonthOf(new Date()));

  private readonly shared = computed(() => (this.isCurrentMonth() ? this.currentMonth() : null));
  private readonly ownUsage = resource({
    params: () => (this.shared() ? undefined : { month: this.month() }),
    loader: ({ params }) => this.api.usage(params.month),
  });

  protected readonly usage = computed(() => this.shared() ?? this.ownUsage);
  protected readonly summary = computed<UsageSummaryResponse | null>(() => {
    const usage = this.usage();
    return usage.hasValue() ? (usage.value() ?? null) : null;
  });
  protected readonly loadError = computed(() => {
    const error = this.usage().error();
    return error ? errorMessage(error, 'Could not load usage.') : null;
  });

  protected readonly projection = computed(() => {
    const summary = this.summary();
    return summary ? projectMonthEndUsd(summary.monthToDateUsd, summary.month, new Date()) : null;
  });

  protected readonly stats = computed<UsageStat[]>(() => {
    const summary = this.summary();
    if (!summary) {
      return [];
    }
    const projection = this.projection();
    const failed = summary.monthFailedRequests;
    return [
      {
        label: this.isCurrentMonth() ? 'Month to date' : 'Month total',
        value: formatUsd(summary.monthToDateUsd),
        hint: this.isCurrentMonth() ? 'since the 1st' : 'whole month',
      },
      {
        label: 'Requests',
        value: formatNumber(summary.monthRequests),
        hint: failed > 0 ? `${formatNumber(failed)} failed` : 'none failed',
      },
      {
        label: 'Average',
        value: formatUsd(summary.avgCostPerRequestUsd),
        hint: 'per request',
      },
      projection === null
        ? { label: 'Last 30 days', value: formatUsd(summary.last30DaysUsd), hint: 'rolling' }
        : { label: 'Projected', value: formatUsd(projection), hint: 'by month end' },
    ];
  });

  protected readonly budget = computed(() => {
    const summary = this.summary();
    const status = summary ? budgetStatus(summary.monthToDateUsd, summary.budgetUsd) : null;
    if (!summary || !status || summary.budgetUsd === null) {
      return null;
    }
    const projection = this.projection();
    const projectedOver = projection !== null && projection > summary.budgetUsd;
    return {
      ...status,
      barClass: BUDGET_BAR_CLASSES[status.level],
      spentText: formatUsd(summary.monthToDateUsd),
      budgetText: formatUsd(summary.budgetUsd),
      note: budgetNote(status, this.isCurrentMonth(), projectedOver),
      noteClass:
        status.level === 'over' ? 'text-danger' : projectedOver ? 'text-warn' : 'text-muted',
    };
  });

  protected readonly models = computed(() => {
    const summary = this.summary();
    return summary
      ? modelBreakdown(summary.byModel, this.modelLabels()).map((row) => ({
          ...row,
          costText: formatUsd(row.costUsd),
          sharePercent: Math.max(2, Math.round(row.share * 100)),
        }))
      : [];
  });

  protected readonly records = computed<UsageRecordRow[]>(() =>
    (this.summary()?.recent ?? []).map((record) => this.toRow(record)),
  );

  protected readonly emptyText = computed(() =>
    this.summary()?.monthRequests === 0
      ? `No AI requests in ${monthLabel(this.month())}.`
      : 'No recent requests to show.',
  );

  protected readonly footer = computed(() => {
    const summary = this.summary();
    return summary
      ? `Last 30 days ${formatUsd(summary.last30DaysUsd)} · All time ${formatUsd(summary.allTimeUsd)}`
      : '';
  });

  protected selectMonth(event: Event): void {
    this.month.set((event.target as HTMLSelectElement).value);
  }

  protected retry(): void {
    this.usage().reload();
  }

  private toRow(record: UsageRecordDto): UsageRecordRow {
    return {
      id: record.id,
      model: this.modelLabels().get(record.model) ?? record.model,
      mode: USAGE_MODE_LABELS[record.mode] ?? record.mode,
      when: recordWhen(record.createdAt),
      tokens: `${formatTokenCount(record.inputTokens)} in · ${formatTokenCount(record.outputTokens)} out`,
      duration: formatDuration(record.durationMs),
      cost: formatUsd(record.costUsd),
      success: record.success,
      error: record.success ? null : (record.errorKind ?? 'error').replace(/_/g, ' '),
    };
  }
}
