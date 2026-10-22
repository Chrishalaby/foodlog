import { Component, input } from '@angular/core';
import { Icon, type IconName } from '../../shared/ui/icon';

export type FormAlertTone = 'danger' | 'info';

@Component({
  selector: 'app-form-alert',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div
      class="flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-snug"
      [class]="
        tone() === 'danger'
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-accent/30 bg-accent/10 text-fg'
      "
      [attr.role]="tone() === 'danger' ? 'alert' : 'status'"
    >
      <app-icon class="mt-px" [name]="icon()" [size]="18" />
      <span class="min-w-0 flex-1 break-words">{{ message() }}</span>
    </div>
  `,
})
export class FormAlert {
  readonly message = input.required<string>();
  readonly tone = input<FormAlertTone>('danger');
  readonly icon = input<IconName>('alert');
}
