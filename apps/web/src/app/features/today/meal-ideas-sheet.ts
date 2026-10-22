import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  untracked,
} from '@angular/core';
import { API_LIMITS, type DaySummary, type EntryDto, type MealIdea } from '@food/shared';
import { errorMessage } from '../../core/errors';
import { ToastService } from '../../core/toast.service';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { Icon } from '../../shared/ui/icon';
import { MealTypeBadge } from '../../shared/ui/meal-type-badge';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { VoiceButton } from '../../shared/ui/voice-button';
import { formatNumber } from '../../shared/utils/format';
import { appendTranscript } from '../../shared/utils/voice-text';
import {
  IDEAS_TITLE,
  ideaAfter,
  ideasBasis,
  isNewFood,
  leftLine,
  macroLine,
  partAmount,
  type IdeaAfter,
} from './meal-ideas-model';
import { MealIdeasStore, type IdeasContext } from './meal-ideas.store';

interface IdeaPartRow {
  name: string;
  amount: string;
  isNew: boolean;
}

interface IdeaCard {
  idea: MealIdea;
  calories: string;
  macros: string;
  parts: IdeaPartRow[];
  after: IdeaAfter | null;
}

@Component({
  selector: 'app-meal-ideas-sheet',
  imports: [BottomSheet, Icon, MealTypeBadge, Skeleton, Spinner, VoiceButton],
  templateUrl: './meal-ideas-sheet.html',
})
export class MealIdeasSheet {
  private readonly toast = inject(ToastService);

  protected readonly store = inject(MealIdeasStore);

  readonly open = model(false);
  readonly date = input.required<string>();
  readonly day = input<DaySummary | null>(null);
  readonly logged = output<EntryDto>();

  protected readonly title = IDEAS_TITLE;
  protected readonly noteMax = API_LIMITS.mealIdeaNoteMax;
  protected readonly placeholders = [0, 1, 2];
  protected readonly left = computed(() => {
    const day = this.day();
    return day ? leftLine(day) : '';
  });
  protected readonly loading = computed(() => this.store.status() === 'loading');
  protected readonly busy = computed(() => this.store.logging() !== null);
  protected readonly cards = computed<IdeaCard[]>(() => {
    const day = this.day();
    return this.store.ideas().map((idea) => ({
      idea,
      calories: formatNumber(idea.totals.calories),
      macros: macroLine(idea),
      parts: idea.parts.map((part) => ({
        name: part.name,
        amount: partAmount(part),
        isNew: isNewFood(part),
      })),
      after: day ? ideaAfter(day, idea) : null,
    }));
  });

  constructor() {
    effect(() => {
      if (!this.open()) {
        return;
      }
      untracked(() => {
        const context = this.context();
        if (context) {
          void this.store.open(context);
        }
      });
    });
  }

  protected askAgain(event?: Event): void {
    event?.preventDefault();
    const context = this.context();
    if (context && !this.loading() && !this.busy()) {
      void this.store.ask(context, { different: true });
    }
  }

  protected onNote(event: Event): void {
    this.store.setNote((event.target as HTMLTextAreaElement).value);
  }

  protected addTranscript(text: string): void {
    this.store.setNote(appendTranscript(this.store.note(), text, this.noteMax));
  }

  protected async log(idea: MealIdea): Promise<void> {
    if (this.busy()) {
      return;
    }
    try {
      const entry = await this.store.log(idea, this.date());
      this.open.set(false);
      this.logged.emit(entry);
    } catch (err) {
      this.toast.error(errorMessage(err, `Could not log “${idea.title}”.`));
    }
  }

  private context(): IdeasContext | null {
    const day = this.day();
    return day ? { date: this.date(), basis: ideasBasis(this.date(), day) } : null;
  }
}
