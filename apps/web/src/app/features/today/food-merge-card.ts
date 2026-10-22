import {
  Component,
  DOCUMENT,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import type { FoodMergeSuggestion } from '@food/shared';
import { AuthService } from '../../core/auth.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage } from '../../core/errors';
import { MyFoodsStore } from '../../core/my-foods.store';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/ui/icon';
import { mergeCardText } from '../../shared/ui/my-foods/merge-model';
import { MergeSheet } from '../../shared/ui/my-foods/merge-sheet';
import { lowerFirst } from '../../shared/utils/saved-foods';
import {
  mergeCardStorageKey,
  pickMergeCard,
  readMergeMemory,
  sameMemory,
  snoozedMemory,
  writeMergeMemory,
  type MergeCardMemory,
} from './merge-card-memory';

function resolveStorage(document: Document): Storage | null {
  try {
    return document.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

@Component({
  selector: 'app-food-merge-card',
  imports: [Icon, MergeSheet],
  host: { class: 'block', '[class.hidden]': '!suggestion() && !sheetOpen()' },
  template: `
    @if (suggestion(); as current) {
      <section class="card animate-fade-in p-4" aria-labelledby="food-merge-card-title">
        <div class="flex items-start gap-3">
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"
            aria-hidden="true"
          >
            <app-icon name="link" [size]="20" />
          </span>
          <div class="min-w-0 flex-1">
            <h2 id="food-merge-card-title" class="text-[15px] leading-5 font-semibold text-fg">
              {{ text() }}
            </h2>
            <p class="mt-1 text-xs leading-snug text-muted">
              Pick one set of values and your past logs follow.
            </p>
          </div>
        </div>
        <div class="mt-3 flex gap-2">
          <button type="button" class="btn btn-primary flex-1" (click)="review(current)">
            Review
          </button>
          <button type="button" class="btn btn-secondary flex-1" (click)="snooze()">Not now</button>
        </div>
        <button
          type="button"
          class="btn btn-ghost mt-1 w-full text-sm text-muted hover:text-fg"
          [disabled]="dismissing()"
          (click)="dismiss(current)"
        >
          Don’t ask for {{ subject() }}
        </button>
      </section>
    }
    <app-merge-sheet [(open)]="sheetOpen" [suggestion]="selected()" />
  `,
})
export class FoodMergeCard {
  private readonly store = inject(MyFoodsStore);
  private readonly events = inject(DataEventsService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly storage = resolveStorage(inject(DOCUMENT));

  readonly today = input.required<string>();

  private readonly storageKey = computed(() => mergeCardStorageKey(this.auth.user()?.id ?? null));
  private readonly memory = linkedSignal(() => readMergeMemory(this.storage, this.storageKey()));
  private readonly pick = computed(() =>
    this.store.suggestionsStatus() === 'ready'
      ? pickMergeCard(this.store.suggestions(), this.memory(), this.today())
      : null,
  );

  protected readonly suggestion = computed(() => this.pick()?.suggestion ?? null);
  protected readonly text = computed(() => {
    const suggestion = this.suggestion();
    return suggestion ? mergeCardText(suggestion) : '';
  });
  protected readonly subject = computed(() => lowerFirst(this.suggestion()?.label ?? 'this food'));
  protected readonly selected = signal<FoodMergeSuggestion | null>(null);
  protected readonly sheetOpen = signal(false);
  protected readonly dismissing = signal(false);

  constructor() {
    effect(() => {
      this.events.entries();
      this.events.products();
      untracked(() => void this.store.ensureSuggestions());
    });
    effect(() => {
      const pick = this.pick();
      if (!pick) {
        return;
      }
      untracked(() => {
        if (!sameMemory(pick.memory, this.memory())) {
          this.remember(pick.memory);
        }
      });
    });
  }

  protected review(suggestion: FoodMergeSuggestion): void {
    this.selected.set(suggestion);
    this.sheetOpen.set(true);
  }

  protected snooze(): void {
    this.remember(snoozedMemory(this.memory(), this.today()));
  }

  protected async dismiss(suggestion: FoodMergeSuggestion): Promise<void> {
    if (this.dismissing()) {
      return;
    }
    this.dismissing.set(true);
    try {
      await this.store.dismiss(suggestion.key);
      this.toast.info(`We won’t ask about ${lowerFirst(suggestion.label)} again.`);
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not update your suggestions.'));
    } finally {
      this.dismissing.set(false);
    }
  }

  private remember(memory: MergeCardMemory): void {
    this.memory.set(memory);
    writeMergeMemory(this.storage, this.storageKey(), memory);
  }
}
