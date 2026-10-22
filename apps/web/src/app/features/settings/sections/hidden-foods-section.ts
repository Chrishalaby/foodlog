import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { errorMessage } from '../../../core/errors';
import { ToastService } from '../../../core/toast.service';
import { Icon } from '../../../shared/ui/icon';
import { Skeleton } from '../../../shared/ui/skeleton';
import { Spinner } from '../../../shared/ui/spinner';
import { SettingsSection } from './settings-section';

export const HIDDEN_FOODS_LOAD_FAILED_MESSAGE = 'Could not load your hidden suggestions.';
export const HIDDEN_FOODS_PREVIEW_COUNT = 8;

type LoadState = 'loading' | 'ready' | 'error';

interface HiddenFoodRow {
  name: string;
  label: string;
}

export function sortHiddenNames(names: readonly string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export function hiddenFoodLabel(name: string): string {
  return name.length > 0 ? name[0].toLocaleUpperCase() + name.slice(1) : name;
}

@Component({
  selector: 'app-hidden-foods-section',
  imports: [SettingsSection, Icon, Skeleton, Spinner],
  template: `
    <app-settings-section
      sectionId="settings-hidden-foods"
      heading="Hidden suggestions"
      icon="eye-off"
      tone="warn"
      description="Foods you removed from Quick add and search. Everything you logged is kept."
    >
      @switch (state()) {
        @case ('loading') {
          <div class="flex flex-col gap-2" aria-busy="true" aria-label="Loading hidden suggestions">
            <app-skeleton class="h-13" />
            <app-skeleton class="h-13" />
          </div>
        }
        @case ('error') {
          <div class="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3" role="alert">
            <app-icon class="text-danger" name="alert" [size]="18" />
            <p class="min-w-0 flex-1 text-sm text-muted">{{ error() }}</p>
            <button type="button" class="btn btn-ghost px-3 text-brand" (click)="load()">
              Retry
            </button>
          </div>
        }
        @default {
          @if (rows().length === 0) {
            <div class="flex items-start gap-3 rounded-xl bg-surface-2 px-3.5 py-3">
              <app-icon class="mt-0.5 shrink-0 text-muted" name="eye" [size]="18" />
              <p class="min-w-0 flex-1 text-sm leading-snug text-muted">
                Nothing hidden. Long-press a food in Quick add to remove it from your suggestions.
              </p>
            </div>
          } @else {
            <ul class="flex flex-col gap-2" role="list" aria-label="Hidden suggestions">
              @for (row of shownRows(); track row.name) {
                <li
                  class="flex min-h-13 items-center gap-3 rounded-xl bg-surface-2 py-1 pr-1 pl-3.5"
                >
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {{ row.label }}
                  </span>
                  <button
                    type="button"
                    class="btn btn-ghost shrink-0 px-3 text-brand"
                    [attr.aria-label]="'Unhide ' + row.label"
                    [disabled]="pending().has(row.name)"
                    (click)="unhide(row.name)"
                  >
                    @if (pending().has(row.name)) {
                      <app-spinner [size]="16" label="Unhiding" />
                    } @else {
                      <app-icon name="eye" [size]="18" />
                    }
                    Unhide
                  </button>
                </li>
              }
            </ul>
            @if (collapsible()) {
              <button
                type="button"
                class="btn btn-secondary mt-3 w-full"
                [attr.aria-expanded]="expanded()"
                (click)="expanded.set(!expanded())"
              >
                <app-icon [name]="expanded() ? 'chevron-up' : 'chevron-down'" [size]="18" />
                {{ expanded() ? 'Show fewer' : 'Show all ' + rows().length }}
              </button>
            }
          }
        }
      }
    </app-settings-section>
  `,
})
export class HiddenFoodsSection {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly toast = inject(ToastService);
  private loadVersion = 0;
  private ownEntriesVersion: number | null = null;

  protected readonly names = signal<readonly string[]>([]);
  protected readonly state = signal<LoadState>('loading');
  protected readonly error = signal<string | null>(null);
  protected readonly pending = signal<ReadonlySet<string>>(new Set());
  protected readonly expanded = signal(false);
  protected readonly rows = computed<HiddenFoodRow[]>(() =>
    this.names().map((name) => ({ name, label: hiddenFoodLabel(name) })),
  );
  protected readonly shownRows = computed(() =>
    this.expanded() ? this.rows() : this.rows().slice(0, HIDDEN_FOODS_PREVIEW_COUNT),
  );
  protected readonly collapsible = computed(() => this.rows().length > HIDDEN_FOODS_PREVIEW_COUNT);

  constructor() {
    effect(() => {
      const version = this.events.entries();
      untracked(() => {
        if (version !== this.ownEntriesVersion) {
          void this.load({ silent: true });
        }
      });
    });
  }

  async load(options: { silent?: boolean } = {}): Promise<void> {
    const silent = options.silent === true && this.state() === 'ready';
    const version = ++this.loadVersion;
    if (!silent) {
      this.state.set('loading');
      this.error.set(null);
    }
    try {
      const response = await this.api.hiddenFoods();
      if (version !== this.loadVersion) {
        return;
      }
      this.applyNames(response.names);
      this.state.set('ready');
    } catch (err) {
      if (version !== this.loadVersion || silent) {
        return;
      }
      this.error.set(errorMessage(err, HIDDEN_FOODS_LOAD_FAILED_MESSAGE));
      this.state.set('error');
    }
  }

  protected async unhide(name: string): Promise<void> {
    if (this.pending().has(name)) {
      return;
    }
    const label = hiddenFoodLabel(name);
    this.loadVersion++;
    this.setPending(name, true);
    try {
      const response = await this.api.unhideFood(name);
      this.loadVersion++;
      this.setPending(name, false);
      this.applyNames(response.names.filter((hidden) => hidden !== name));
      this.events.notify('entries');
      this.ownEntriesVersion = this.events.entries();
      this.toast.success(`“${label}” is back in your suggestions`);
    } catch (err) {
      this.setPending(name, false);
      this.toast.error(errorMessage(err, `Could not unhide “${label}”.`));
    }
  }

  private applyNames(names: readonly string[]): void {
    this.names.set(sortHiddenNames(names));
  }

  private setPending(name: string, busy: boolean): void {
    this.pending.update((current) => {
      const next = new Set(current);
      if (busy) {
        next.add(name);
      } else {
        next.delete(name);
      }
      return next;
    });
  }
}
