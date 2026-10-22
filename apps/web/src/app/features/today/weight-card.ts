import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Goal, WeightLogDto } from '@food/shared';
import { errorMessage } from '../../core/errors';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/ui/icon';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { WeightField } from '../stats/weight-field';
import {
  dayPhrase,
  formatKg,
  formatSigned,
  lastTrendPoint,
  readWeighInDraft,
  weightChangeTone,
  weightText,
  type ChangeTone,
} from '../stats/weight-math';
import { WeightCardStore } from './weight-card-store';

const TONE_CLASSES: Record<ChangeTone, string> = {
  good: 'text-ok',
  caution: 'text-warn',
  neutral: 'text-muted',
};

function latestHint(latest: WeightLogDto | null, date: string, today: string): string {
  if (!latest) {
    return 'Weigh in a few times a week to see your trend';
  }
  if (latest.date === date) {
    return `Logged ${formatKg(latest.weightKg)} kg`;
  }
  return `Last ${formatKg(latest.weightKg)} kg, ${dayPhrase(latest.date, today)}`;
}

function prefersReducedMotion(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  return typeof view?.matchMedia === 'function'
    ? view.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export const WEIGHT_STATS_LINK = ['/stats'] as const;
export const WEIGHT_STATS_QUERY = { tab: 'weight' } as const;

@Component({
  selector: 'app-weight-card',
  imports: [Icon, RouterLink, Skeleton, Spinner, WeightField],
  host: { class: 'block scroll-mt-24' },
  template: `
    <section class="card relative" aria-labelledby="weight-card-title">
      @switch (status()) {
        @case ('loading') {
          <div class="flex items-center gap-3 p-4" role="status" aria-label="Loading weight">
            <app-skeleton class="size-10 shrink-0 rounded-xl" />
            <div class="flex-1 space-y-2">
              <app-skeleton shape="text" class="w-24" />
              <app-skeleton class="h-5 w-16" />
            </div>
            <app-skeleton shape="text" class="w-20" />
          </div>
        }
        @case ('error') {
          <div class="flex items-center gap-3 py-3 pr-2 pl-4" role="alert">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger/12 text-danger"
            >
              <app-icon name="scale" [size]="20" />
            </span>
            <p id="weight-card-title" class="min-w-0 flex-1 text-sm text-muted">
              Couldn’t load your weight.
            </p>
            <button type="button" class="btn btn-ghost min-h-11 px-3 text-brand" (click)="retry()">
              Retry
            </button>
          </div>
        }
        @default {
          @if (view(); as view) {
            @if (view.logged && !editing()) {
              <a
                class="absolute inset-0 rounded-card"
                [routerLink]="statsLink"
                [queryParams]="statsQuery"
                [attr.aria-label]="view.linkLabel"
              ></a>
              <div class="pointer-events-none relative flex items-center gap-3 py-3 pr-2 pl-4">
                <span
                  class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"
                >
                  <app-icon name="scale" [size]="20" />
                </span>
                <div class="min-w-0 flex-1">
                  <h2 id="weight-card-title" class="truncate text-xs font-medium text-muted">
                    {{ view.loggedCaption }}
                  </h2>
                  <p
                    class="text-xl leading-7 font-bold tracking-tight text-fg tabular-nums animate-pop-in"
                  >
                    {{ view.logged }}<span class="ml-1 text-xs font-medium text-muted">kg</span>
                  </p>
                </div>
                @if (view.trend) {
                  <div class="shrink-0 text-right text-xs leading-5">
                    <p class="text-muted">
                      Trend
                      <span class="font-semibold text-fg tabular-nums">{{ view.trend }} kg</span>
                    </p>
                    @if (view.weekly) {
                      <p class="font-semibold tabular-nums" [class]="view.toneClass">
                        {{ view.weekly }} kg/wk
                      </p>
                    }
                  </div>
                }
                <button
                  type="button"
                  class="btn btn-ghost btn-icon pointer-events-auto relative text-muted"
                  aria-label="Change this weigh-in"
                  (click)="edit()"
                >
                  <app-icon name="edit" [size]="18" />
                </button>
              </div>
            } @else {
              <div class="p-4">
                <div class="relative flex min-h-10 items-center gap-3">
                  @if (!editing()) {
                    <a
                      class="absolute -inset-2 rounded-2xl"
                      [routerLink]="statsLink"
                      [queryParams]="statsQuery"
                      [attr.aria-label]="view.linkLabel"
                    ></a>
                  }
                  <span
                    class="pointer-events-none relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"
                  >
                    <app-icon name="scale" [size]="20" />
                  </span>
                  <div class="pointer-events-none relative min-w-0 flex-1">
                    <h2 id="weight-card-title" class="truncate text-sm font-semibold text-fg">
                      {{ view.entryTitle }}
                    </h2>
                    <p class="truncate text-xs text-muted">{{ view.entryHint }}</p>
                  </div>
                  @if (editing()) {
                    <button
                      type="button"
                      class="btn btn-ghost relative min-h-11 px-3 text-muted"
                      (click)="cancelEdit()"
                    >
                      Cancel
                    </button>
                  } @else if (view.trend) {
                    <div
                      class="pointer-events-none relative flex shrink-0 items-center gap-1 text-right text-xs leading-5"
                    >
                      <div>
                        <p class="text-muted">
                          Trend
                          <span class="font-semibold text-fg tabular-nums"
                            >{{ view.trend }} kg</span
                          >
                        </p>
                        @if (view.weekly) {
                          <p class="font-semibold tabular-nums" [class]="view.toneClass">
                            {{ view.weekly }} kg/wk
                          </p>
                        }
                      </div>
                      <app-icon class="text-muted" name="chevron-right" [size]="16" />
                    </div>
                  }
                </div>
                <form class="mt-3 flex items-center gap-2" novalidate (submit)="save($event)">
                  <app-weight-field
                    class="min-w-0 flex-1"
                    inputId="today-weight-input"
                    [(text)]="text"
                    [fallback]="view.prefill"
                    [ariaLabel]="view.inputLabel"
                    [invalid]="errorText() !== null"
                    [describedBy]="errorText() ? 'today-weight-error' : null"
                    [disabled]="saving()"
                  />
                  <button
                    type="submit"
                    class="btn btn-primary min-w-[4.5rem] shrink-0 px-3"
                    [disabled]="saving()"
                  >
                    @if (saving()) {
                      <app-spinner [size]="18" label="Saving" />
                    } @else {
                      Save
                    }
                  </button>
                </form>
                @if (errorText(); as message) {
                  <p id="today-weight-error" class="mt-2 text-xs text-danger" role="alert">
                    {{ message }}
                  </p>
                }
              </div>
            }
          }
        }
      }
    </section>
  `,
})
export class WeightCard {
  private readonly store = inject(WeightCardStore);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly field = viewChild(WeightField);

  readonly date = input.required<string>();
  readonly today = input.required<string>();
  readonly goal = input<Goal | null>(null);
  readonly profileWeight = input<number | null>(null);

  protected readonly statsLink = WEIGHT_STATS_LINK;
  protected readonly statsQuery = WEIGHT_STATS_QUERY;
  protected readonly saving = signal(false);
  protected readonly showError = linkedSignal({ source: this.date, computation: () => false });
  protected readonly editing = linkedSignal({ source: this.date, computation: () => false });

  protected readonly status = computed(() =>
    this.store.date() === this.date() ? this.store.status() : 'loading',
  );

  protected readonly view = computed(() => {
    const date = this.date();
    const summary = this.store.date() === date ? this.store.summary() : null;
    if (!summary) {
      return null;
    }
    const today = this.today();
    const phrase = dayPhrase(date, today);
    const logged = summary.logs.find((log) => log.date === date) ?? null;
    const trend = lastTrendPoint(summary.trend);
    const weekly = summary.weeklyChangeKg;
    const bodyKg = trend?.trendKg ?? summary.latest?.weightKg ?? null;
    const prefill = logged?.weightKg ?? summary.latest?.weightKg ?? this.profileWeight();
    const isToday = date === today;
    return {
      logged: logged ? formatKg(logged.weightKg) : null,
      loggedCaption: isToday ? 'Today’s weight' : `Weight on ${phrase}`,
      entryTitle: logged
        ? `Edit weight for ${phrase}`
        : isToday
          ? 'Log today’s weight'
          : `Log weight for ${phrase}`,
      entryHint: latestHint(summary.latest, date, today),
      inputLabel: `Weight for ${phrase} in kg`,
      trend: trend ? formatKg(trend.trendKg) : null,
      weekly: weekly === null ? null : formatSigned(weekly, 2),
      toneClass: TONE_CLASSES[weightChangeTone(weekly, this.goal(), bodyKg)],
      prefill,
      linkLabel: trend
        ? `Weight trend ${formatKg(trend.trendKg)} kg. Open weight stats`
        : 'Open weight stats',
    };
  });

  readonly ready = computed(() => this.view() !== null);

  private readonly prefill = computed(
    () => ({ date: this.date(), weightKg: this.view()?.prefill ?? null }),
    { equal: (a, b) => a.date === b.date && a.weightKg === b.weightKg },
  );

  protected readonly text = linkedSignal({
    source: this.prefill,
    computation: ({ weightKg }) => weightText(weightKg),
  });

  protected readonly errorText = computed(() =>
    this.showError() ? readWeighInDraft(this.text()).weightError : null,
  );

  focusEntry(): void {
    this.editing.set(true);
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        host.scrollIntoView?.({
          block: 'center',
          behavior: prefersReducedMotion(host) ? 'auto' : 'smooth',
        });
        this.field()?.focus();
      },
      { injector: this.injector },
    );
  }

  protected edit(): void {
    this.focusEntry();
  }

  protected cancelEdit(): void {
    this.editing.set(false);
    this.showError.set(false);
    this.text.set(weightText(this.view()?.prefill ?? null));
  }

  protected retry(): void {
    void this.store.retry();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) {
      return;
    }
    const draft = readWeighInDraft(this.text());
    if (draft.weightError || draft.weightKg === null) {
      this.showError.set(true);
      return;
    }
    const date = this.date();
    this.saving.set(true);
    try {
      const log = await this.store.save(date, draft.weightKg);
      this.showError.set(false);
      this.editing.set(false);
      this.toast.success(
        `Saved ${formatKg(log.weightKg)} kg for ${dayPhrase(log.date, this.today())}`,
      );
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not save your weight.'));
    } finally {
      this.saving.set(false);
    }
  }
}
