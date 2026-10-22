import { Component, computed, input } from '@angular/core';
import type { FieldTree } from '@angular/forms/signals';

@Component({
  selector: 'app-field-error',
  host: { class: 'block empty:hidden' },
  template: `
    @if (message(); as text) {
      <p class="mt-1.5 text-xs leading-snug text-danger" [attr.id]="errorId()">{{ text }}</p>
    }
  `,
})
export class FieldError {
  readonly field = input.required<FieldTree<unknown>>();
  readonly errorId = input<string | null>(null);

  protected readonly message = computed(() => {
    const state = this.field()();
    return state.touched() ? (state.errors()[0]?.message ?? null) : null;
  });
}
