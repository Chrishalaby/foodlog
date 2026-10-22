import { Component, computed, input, signal } from '@angular/core';
import {
  FormField,
  type FieldTree,
  type SchemaPath,
  maxLength,
  minLength,
  required,
  validate,
} from '@angular/forms/signals';
import { API_LIMITS } from '@food/shared';
import { Icon } from '../../shared/ui/icon';

export const PASSWORD_MISMATCH_MESSAGE = 'Passwords do not match.';

export function newPasswordRules(password: SchemaPath<string>, confirm: SchemaPath<string>): void {
  required(password, { message: 'Choose a password.' });
  minLength(password, API_LIMITS.passwordMin, {
    message: `Use at least ${API_LIMITS.passwordMin} characters.`,
  });
  maxLength(password, API_LIMITS.passwordMax, {
    message: `Use at most ${API_LIMITS.passwordMax} characters.`,
  });
  required(confirm, { message: 'Repeat your password.' });
  validate(confirm, ({ value, valueOf }) =>
    value() !== '' && value() !== valueOf(password)
      ? { kind: 'mismatch', message: PASSWORD_MISMATCH_MESSAGE }
      : undefined,
  );
}

@Component({
  selector: 'app-new-password-fields',
  imports: [FormField, Icon],
  host: { class: 'flex flex-col gap-4' },
  template: `
    <div>
      <label class="label" [for]="passwordId()">{{ label() }}</label>
      <div class="relative">
        <input
          class="input pr-12"
          autocomplete="new-password"
          [id]="passwordId()"
          [type]="visible() ? 'text' : 'password'"
          [formField]="password()"
          [attr.aria-describedby]="passwordId() + '-hint'"
          [attr.aria-invalid]="password()().touched() && password()().invalid()"
        />
        <button
          type="button"
          class="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted transition hover:text-fg"
          [attr.aria-label]="visible() ? 'Hide passwords' : 'Show passwords'"
          [attr.aria-pressed]="visible()"
          (click)="toggle()"
        >
          <app-icon [name]="visible() ? 'eye-off' : 'eye'" />
        </button>
      </div>
      @if (passwordError(); as message) {
        <p class="mt-1.5 text-xs text-danger" [id]="passwordId() + '-hint'">{{ message }}</p>
      } @else {
        <p class="mt-1.5 text-xs text-muted" [id]="passwordId() + '-hint'">
          At least {{ passwordMin }} characters. A short sentence works well.
        </p>
      }
    </div>
    <div>
      <label class="label" [for]="confirmId()">Confirm password</label>
      <input
        class="input"
        autocomplete="new-password"
        [id]="confirmId()"
        [type]="visible() ? 'text' : 'password'"
        [formField]="confirm()"
        [attr.aria-describedby]="confirmError() ? confirmId() + '-error' : null"
        [attr.aria-invalid]="confirm()().touched() && confirm()().invalid()"
      />
      @if (confirmError(); as message) {
        <p class="mt-1.5 text-xs text-danger" [id]="confirmId() + '-error'">{{ message }}</p>
      }
    </div>
  `,
})
export class NewPasswordFields {
  readonly password = input.required<FieldTree<string>>();
  readonly confirm = input.required<FieldTree<string>>();
  readonly idPrefix = input.required<string>();
  readonly label = input('Password');

  protected readonly passwordMin = API_LIMITS.passwordMin;
  protected readonly visible = signal(false);
  protected readonly passwordId = computed(() => `${this.idPrefix()}-password`);
  protected readonly confirmId = computed(() => `${this.idPrefix()}-confirm`);
  protected readonly passwordError = computed(() => fieldError(this.password()));
  protected readonly confirmError = computed(() => fieldError(this.confirm()));

  protected toggle(): void {
    this.visible.update((visible) => !visible);
  }
}

function fieldError(field: FieldTree<string>): string | null {
  const state = field();
  return state.touched() ? (state.errors()[0]?.message ?? null) : null;
}
