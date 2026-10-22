import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NOTES_ROOT } from '../../../core/app-identity.service';
import { AuthService } from '../../../core/auth.service';
import { Icon } from '../../../shared/ui/icon';

export const NOTES_ENTRY_PATH = NOTES_ROOT;

@Component({
  selector: 'app-notes-entry',
  imports: [RouterLink, Icon],
  host: { class: 'block', '[class.hidden]': '!auth.notesEnabled()' },
  template: `
    <a
      class="card flex min-h-16 items-center gap-3 px-4 py-3 transition active:scale-[0.99]"
      [routerLink]="path"
    >
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warn/15 text-warn"
        aria-hidden="true"
      >
        <app-icon name="edit" [size]="20" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block font-semibold text-fg">Notes</span>
        <span class="block text-sm leading-snug text-muted">
          Notes to self with photos and voice. Install it as its own app.
        </span>
      </span>
      <app-icon class="text-muted" name="chevron-right" [size]="18" />
    </a>
  `,
})
export class NotesEntry {
  protected readonly auth = inject(AuthService);
  protected readonly path = NOTES_ENTRY_PATH;
}
