import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  model,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { API_LIMITS } from '@food/shared';
import { Icon } from '../../shared/ui/icon';
import { CORRECTION_CHIPS, hasHint, toggleHint } from './log-helpers';

let nextCorrectId = 0;

@Component({
  selector: 'app-correct-ai-card',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    @if (open()) {
      <form
        class="animate-fade-in rounded-card border border-accent/30 bg-accent/10 p-3.5"
        [attr.aria-labelledby]="ids.title"
        (submit)="onSubmit($event)"
      >
        <div class="flex items-start gap-2.5">
          <app-icon class="mt-0.5 text-accent" name="sparkles" />
          <div class="min-w-0 flex-1">
            <h2 class="text-[15px] leading-5 font-semibold text-fg" [id]="ids.title">
              Correct the AI
            </h2>
            <p class="mt-0.5 text-xs leading-snug text-muted" [id]="ids.help">
              Say what's wrong. It re-estimates with your correction and keeps everything else.
            </p>
          </div>
        </div>
        <textarea
          #field
          class="input mt-3 resize-none leading-snug"
          rows="3"
          autocapitalize="sentences"
          enterkeyhint="send"
          placeholder="e.g. It was 2 eggs, not 3, and no butter"
          [id]="ids.field"
          [attr.aria-describedby]="ids.help"
          [attr.maxlength]="max"
          [value]="text()"
          [disabled]="disabled()"
          (input)="onInput($event)"
          (keydown.enter)="onEnter($event)"
        ></textarea>
        <div class="mt-2 flex items-start gap-3">
          <div
            class="flex flex-1 flex-wrap gap-x-1.5 gap-y-2"
            role="group"
            aria-label="Quick corrections"
          >
            @for (chip of chips(); track chip.text) {
              <button
                type="button"
                class="chip relative min-h-9 px-3 text-[13px] transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
                [class]="chip.active ? 'bg-brand/15 text-brand' : ''"
                [attr.aria-pressed]="chip.active"
                [disabled]="disabled()"
                (click)="toggle(chip.text)"
              >
                <app-icon [name]="chip.active ? 'check' : 'plus'" [size]="13" [strokeWidth]="2.5" />
                {{ chip.text }}
              </button>
            }
          </div>
          <span class="shrink-0 pt-2 text-[11px] text-muted tabular-nums"
            >{{ count() }}/{{ max }}</span
          >
        </div>
        <div class="mt-3 flex gap-2">
          <button type="button" class="btn btn-ghost flex-1" (click)="cancel()">Cancel</button>
          <button type="submit" class="btn btn-primary flex-[2]" [disabled]="!canSubmit()">
            <app-icon name="refresh" [size]="18" />
            Re-estimate
          </button>
        </div>
      </form>
    } @else {
      <button
        type="button"
        class="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-line/70 bg-surface px-3.5 py-2.5 text-left transition hover:bg-surface-2 active:scale-[0.99] disabled:opacity-50"
        [disabled]="disabled()"
        (click)="start()"
      >
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"
        >
          <app-icon name="edit" [size]="18" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-[15px] leading-5 font-semibold text-fg">Correct the AI</span>
          <span class="block text-xs text-muted">Wrong food or amount? Tell it and re-run</span>
        </span>
        <app-icon class="text-muted" name="chevron-right" [size]="18" />
      </button>
    }
  `,
})
export class CorrectAiCard {
  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');

  readonly open = model(false);
  readonly text = model('');
  readonly disabled = input(false);
  readonly focusToken = input(0);
  readonly submitted = output<string>();

  protected readonly max = API_LIMITS.followUpAnswerMax;
  protected readonly ids = {
    title: `correct-ai-${nextCorrectId}-title`,
    help: `correct-ai-${nextCorrectId}-help`,
    field: `correct-ai-${nextCorrectId++}-field`,
  };
  protected readonly count = computed(() => this.text().length);
  protected readonly canSubmit = computed(() => !this.disabled() && this.text().trim() !== '');
  protected readonly chips = computed(() =>
    CORRECTION_CHIPS.map((text) => ({ text, active: hasHint(this.text(), text) })),
  );

  constructor() {
    afterRenderEffect(() => {
      this.focusToken();
      const field = this.field()?.nativeElement;
      if (field && this.open()) {
        untracked(() => this.focusEnd(field));
      }
    });
  }

  protected start(): void {
    this.open.set(true);
  }

  protected cancel(): void {
    this.open.set(false);
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value.slice(0, this.max));
  }

  protected toggle(chip: string): void {
    this.text.update((text) => toggleHint(text, chip).slice(0, this.max));
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submitText();
  }

  protected onEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing) {
      return;
    }
    event.preventDefault();
    this.submitText();
  }

  private submitText(): void {
    const text = this.text().trim();
    if (text && !this.disabled()) {
      this.submitted.emit(text);
    }
  }

  private focusEnd(field: HTMLTextAreaElement): void {
    field.focus({ preventScroll: false });
    const end = field.value.length;
    field.setSelectionRange(end, end);
  }
}
