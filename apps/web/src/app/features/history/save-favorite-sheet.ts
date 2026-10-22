import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { API_LIMITS, type EntryDto, type FavoriteDto } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { injectDiscardGuard } from '../../shared/ui/discard-guard';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';

@Component({
  selector: 'app-save-favorite-sheet',
  imports: [BottomSheet, Icon, Spinner],
  template: `
    <app-bottom-sheet [(open)]="open" title="Save as favorite" [canClose]="canClose">
      <form class="flex flex-col gap-4" novalidate (submit)="submit($event)">
        <p class="text-sm leading-relaxed text-muted">
          Log this meal again in one tap from Favorites — same nutrients, no new photo or AI
          estimate.
        </p>
        <div>
          <label class="label" [for]="inputId">Name</label>
          <input
            type="text"
            class="input"
            autocomplete="off"
            enterkeyhint="done"
            [id]="inputId"
            [attr.maxlength]="nameMax"
            [attr.aria-invalid]="error() ? true : null"
            [attr.aria-describedby]="error() ? errorId : null"
            [value]="name()"
            (input)="onInput($event)"
          />
          @if (error(); as message) {
            <p class="mt-1.5 text-sm text-danger" role="alert" [id]="errorId">{{ message }}</p>
          }
        </div>
        <button type="submit" class="btn btn-primary min-h-12 w-full" [disabled]="saving()">
          @if (saving()) {
            <app-spinner [size]="18" label="Saving" />
          } @else {
            <app-icon name="star" [size]="18" />
          }
          Save favorite
        </button>
      </form>
    </app-bottom-sheet>
  `,
})
export class SaveFavoriteSheet {
  private static nextId = 0;

  private readonly api = inject(ApiService);

  readonly entry = input<EntryDto | null>(null);
  readonly open = model(false);
  readonly saved = output<FavoriteDto>();

  protected readonly inputId = `save-favorite-name-${SaveFavoriteSheet.nextId++}`;
  protected readonly errorId = `${this.inputId}-error`;
  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly name = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  private readonly initialName = signal('');
  protected readonly dirty = computed(() => this.name().trim() !== this.initialName().trim());
  protected readonly canClose = injectDiscardGuard(
    () => this.dirty(),
    'The name you typed won’t be saved.',
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => {
          const name = this.entry()?.name ?? '';
          this.name.set(name);
          this.initialName.set(name);
          this.error.set(null);
        });
      }
    });
  }

  protected onInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    if (this.error()) {
      this.error.set(null);
    }
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const entry = this.entry();
    if (!entry || this.saving()) {
      return;
    }
    const name = this.name().trim();
    if (name.length === 0) {
      this.error.set('Give this favorite a name.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const favorite = await this.api.createFavoriteFromEntry(entry.id, { name });
      this.open.set(false);
      this.saved.emit(favorite);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not save this favorite.'));
    } finally {
      this.saving.set(false);
    }
  }
}
