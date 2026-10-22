import { Component, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { addDays, type ProfileResponse, type WeightSummaryResponse } from '@food/shared';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { PROFILE_LOAD_FAILED_MESSAGE, ProfileStore } from '../../core/profile.store';
import { relativeDayLabel, shortDateLabel } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import {
  echartsThemeName,
  injectChartPalette,
  provideLazyEcharts,
} from '../../shared/charts/echarts';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { SegmentedControl, type SegmentOption } from '../../shared/ui/segmented-control';
import { Skeleton } from '../../shared/ui/skeleton';
import { formatNumber } from '../../shared/utils/format';
import { AdaptiveBurnCard } from './adaptive-burn-card';
import { latestValue } from './latest-value';
import { StatsError } from './stats-error';
import { StatsState, WEIGHT_RANGES, resourceErrorMessage, type WeightRange } from './stats-state';
import { WeighInList } from './weigh-in-list';
import { WeighInSheet } from './weigh-in-sheet';
import {
  buildWeightChartOption,
  trimLeadingGap,
  weightChartAriaLabel,
  weightChartData,
} from './weight-chart';
import {
  dayPhrase,
  formatKg,
  formatSigned,
  lastTrendPoint,
  percentDecimals,
  recentWeighIns,
  trendRangeChange,
  weighInsPerWeek,
  weeklyPercent,
  weightChangeTone,
  withWeighIn,
  withoutWeighIn,
  type ChangeTone,
  type WeighInInput,
} from './weight-math';

interface WeightData {
  key: string;
  summary: WeightSummaryResponse;
}

const RANGE_LABELS: Record<WeightRange, string> = { 30: '30 days', 90: '90 days', 365: '1 year' };
const RANGE_CAPTIONS: Record<WeightRange, string> = {
  30: 'last 30 days',
  90: 'last 90 days',
  365: 'last 12 months',
};

const RANGE_OPTIONS: readonly SegmentOption<WeightRange>[] = WEIGHT_RANGES.map((days) => ({
  value: days,
  label: RANGE_LABELS[days],
}));

const TONE_CLASSES: Record<ChangeTone, string> = {
  good: 'text-ok',
  caution: 'text-warn',
  neutral: 'text-fg',
};

@Component({
  selector: 'app-stats-weight',
  imports: [
    NgxEchartsDirective,
    AdaptiveBurnCard,
    EmptyState,
    Icon,
    SegmentedControl,
    Skeleton,
    StatsError,
    WeighInList,
    WeighInSheet,
  ],
  providers: [provideLazyEcharts()],
  host: { class: 'block' },
  templateUrl: './stats-weight.html',
})
export class StatsWeight {
  private readonly state = inject(StatsState);
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly profiles = inject(ProfileStore);
  private readonly palette = injectChartPalette();

  protected readonly rangeOptions = RANGE_OPTIONS;
  protected readonly range = this.state.weightRange;
  protected readonly today = this.state.today;
  protected readonly theme = computed(() => echartsThemeName(this.palette()));
  protected readonly busyDate = signal<string | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly sheetOpen = signal(false);
  protected readonly sheetBusy = signal(false);
  protected readonly adopting = signal(false);

  private readonly requestKey = computed(() => {
    const to = this.state.today();
    return `${addDays(to, -(this.range() - 1))}|${to}`;
  });

  private readonly data = resource({
    params: () => ({ key: this.requestKey(), revision: this.state.revision() }),
    loader: async ({ params }): Promise<WeightData> => {
      const [from, to] = params.key.split('|') as [string, string];
      return { key: params.key, summary: await this.state.weights(from, to) };
    },
  });
  private readonly latest = latestValue(this.data);

  protected readonly summary = linkedSignal(() => this.latest()?.summary ?? null);
  protected readonly profile = this.profiles.response;

  protected readonly loading = computed(
    () => this.data.isLoading() && this.latest()?.key !== this.requestKey(),
  );
  protected readonly failed = computed(() => this.data.status() === 'error' && !this.summary());
  protected readonly errorText = computed(() =>
    resourceErrorMessage(this.data.error(), 'Could not load your weight.'),
  );

  protected readonly view = computed(() => {
    const summary = this.summary();
    if (!summary) {
      return null;
    }
    const today = this.today();
    const profile = this.profile();
    const current = lastTrendPoint(summary.trend);
    const bodyKg = current?.trendKg ?? summary.latest?.weightKg ?? null;
    const change = trendRangeChange(summary.trend);
    const weekly = summary.weeklyChangeKg;
    const percent = weeklyPercent(weekly, bodyKg);
    const tone = weightChangeTone(weekly, profile?.profile.goal ?? null, bodyKg);
    const latest = summary.latest;
    return {
      hasAny: latest !== null || summary.logs.length > 0,
      hasRangeLogs: summary.logs.length > 0,
      rangeCaption: RANGE_CAPTIONS[this.range()],
      changeCaption:
        change && change.fromDate > summary.from
          ? `since ${shortDateLabel(change.fromDate, today)}`
          : RANGE_CAPTIONS[this.range()],
      trendKg: current ? formatKg(current.trendKg) : latest ? formatKg(latest.weightKg) : '–',
      trendCaption: current ? 'Trend weight' : 'Latest weigh-in',
      change: change ? `${formatSigned(change.changeKg, 1)} kg` : null,
      weekly: weekly === null ? null : `${formatSigned(weekly, 2)} kg`,
      weeklyPercent:
        percent === null
          ? null
          : `${formatSigned(percent, percentDecimals(percent))}% of body weight`,
      toneClass: TONE_CLASSES[tone],
      latest: latest
        ? {
            weight: `${formatKg(latest.weightKg)} kg`,
            day: relativeDayLabel(latest.date, today),
            date: shortDateLabel(latest.date, today),
          }
        : null,
      rows: recentWeighIns(summary.logs, summary.logs.length),
      perWeek: weighInsPerWeek(summary.logs, summary.to),
      adaptive: summary.adaptiveTdee,
      currentKcal: profile?.targets.tdee ?? null,
      source: profile?.targets.tdeeSource ?? null,
      defaultWeight: latest?.weightKg ?? profile?.profile.weightKg ?? null,
    };
  });

  protected readonly chart = computed(() => {
    const summary = this.summary();
    if (!summary || summary.logs.length === 0) {
      return null;
    }
    const data = weightChartData(trimLeadingGap(summary.trend));
    return {
      option: buildWeightChartOption(data, this.palette(), this.today()),
      label: weightChartAriaLabel(data, data.dates.length),
    };
  });

  constructor() {
    void this.profiles.ensureLoaded();
  }

  protected selectRange(range: WeightRange): void {
    this.range.set(range);
  }

  protected retry(): void {
    this.data.reload();
  }

  protected openSheet(): void {
    this.editing.set(null);
    this.sheetOpen.set(true);
  }

  protected async saveFromList(input: WeighInInput): Promise<void> {
    if (await this.saveWeighIn(input)) {
      this.editing.set(null);
    }
  }

  protected async saveFromSheet(input: WeighInInput): Promise<void> {
    this.sheetBusy.set(true);
    try {
      if (await this.saveWeighIn(input)) {
        this.sheetOpen.set(false);
      }
    } finally {
      this.sheetBusy.set(false);
    }
  }

  protected async removeWeighIn(date: string): Promise<void> {
    const log = this.summary()?.logs.find((item) => item.date === date);
    const confirmed = await this.confirm.confirm({
      title: 'Delete this weigh-in?',
      message: log
        ? `${formatKg(log.weightKg)} kg on ${shortDateLabel(date, this.today())} will be removed.`
        : 'This weigh-in will be removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed || this.busyDate() !== null) {
      return;
    }
    this.busyDate.set(date);
    try {
      await this.api.deleteWeight(date);
    } catch (err) {
      if (httpStatus(err) !== 404) {
        this.toast.error(errorMessage(err, 'Could not delete this weigh-in.'));
        return;
      }
    } finally {
      this.busyDate.set(null);
    }
    this.summary.update((summary) => summary && withoutWeighIn(summary, date));
    this.editing.set(null);
    this.events.notify('weights', 'profile');
    this.toast.success('Weigh-in deleted');
  }

  protected async adoptBurn(kcal: number): Promise<void> {
    if (this.adopting()) {
      return;
    }
    this.adopting.set(true);
    try {
      const previous = await this.saveBurn(kcal);
      this.toast.success(`Daily burn set to ${formatNumber(kcal)} kcal. Targets updated.`, {
        action: { label: 'Undo', run: () => void this.restoreBurn(previous) },
      });
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not update your daily burn.'));
    } finally {
      this.adopting.set(false);
    }
  }

  private async restoreBurn(previous: number | null): Promise<void> {
    try {
      await this.saveBurn(previous);
      this.toast.info('Daily burn restored');
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not restore your daily burn.'));
    }
  }

  private async saveBurn(tdeeOverride: number | null): Promise<number | null> {
    const current = await this.latestProfile();
    if (!current) {
      throw new Error(this.profiles.error() ?? PROFILE_LOAD_FAILED_MESSAGE);
    }
    const previous = current.profile.tdeeOverride ?? null;
    await this.profiles.save({ ...current.profile, tdeeOverride });
    return previous;
  }

  private latestProfile(): Promise<ProfileResponse | null> {
    return this.profiles.fresh().catch(() => null);
  }

  private async saveWeighIn(input: WeighInInput): Promise<boolean> {
    if (this.busyDate() !== null) {
      return false;
    }
    this.busyDate.set(input.date);
    try {
      const { date, ...body } = input;
      const log = await this.api.putWeight(date, body);
      this.summary.update((summary) => summary && withWeighIn(summary, log));
      this.events.notify('weights', 'profile');
      this.toast.success(
        `Saved ${formatKg(log.weightKg)} kg for ${dayPhrase(log.date, this.today())}`,
      );
      return true;
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not save this weigh-in.'));
      return false;
    } finally {
      this.busyDate.set(null);
    }
  }
}
