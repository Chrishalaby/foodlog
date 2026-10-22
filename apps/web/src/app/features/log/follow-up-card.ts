import { Component, computed, input, model, output } from '@angular/core';
import { API_LIMITS } from '@food/shared';
import { Icon } from '../../shared/ui/icon';

let nextCardId = 0;

@Component({
  selector: 'app-follow-up-card',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <section
      class="rounded-card border border-accent/30 bg-accent/10 p-3.5"
      [attr.aria-labelledby]="titleId"
    >
      <div class="flex items-start gap-2.5">
        <app-icon class="mt-0.5 text-accent" name="info" />
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-semibold tracking-[0.08em] text-accent uppercase">
            Quick question
          </p>
          <h2 class="mt-0.5 text-[15px] leading-snug font-semibold text-fg" [id]="titleId">
            {{ question() }}
          </h2>
          <p class="mt-1 text-xs text-muted">Answering sharpens the estimate.</p>
        </div>
      </div>

      @if (options().length > 0) {
        <div class="mt-3 flex flex-wrap gap-2">
          @for (option of options(); track option) {
            <button
              type="button"
              class="btn btn-secondary rounded-full px-3.5 text-sm"
              [disabled]="disabled()"
              (click)="submit(option)"
            >
              {{ option }}
            </button>
          }
        </div>
      }

      <form class="mt-3 flex gap-2" (submit)="onSubmit($event)">
        <input
          type="text"
          class="input min-w-0 flex-1"
          autocomplete="off"
          enterkeyhint="send"
          placeholder="Or type your answer"
          aria-label="Your answer"
          [attr.maxlength]="answerMax"
          [value]="answer()"
          [disabled]="disabled()"
          (input)="onInput($event)"
        />
        <button type="submit" class="btn btn-primary shrink-0" [disabled]="!canSubmit()">
          Update
        </button>
      </form>
    </section>
  `,
})
export class FollowUpCard {
  readonly question = input.required<string>();
  readonly options = input<readonly string[]>([]);
  readonly disabled = input(false);
  readonly answer = model('');
  readonly submitted = output<string>();

  protected readonly titleId = `follow-up-${nextCardId++}`;
  protected readonly answerMax = API_LIMITS.followUpAnswerMax;
  protected readonly canSubmit = computed(() => !this.disabled() && this.answer().trim() !== '');

  protected onInput(event: Event): void {
    this.answer.set((event.target as HTMLInputElement).value);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submit(this.answer());
  }

  protected submit(value: string): void {
    const text = value.trim();
    if (text && !this.disabled()) {
      this.submitted.emit(text);
    }
  }
}
