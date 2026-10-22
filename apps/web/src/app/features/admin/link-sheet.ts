import { Component, computed, input, model } from '@angular/core';
import type { InviteLinkResponse } from '@food/shared';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { Icon } from '../../shared/ui/icon';
import { expiryLabel, personLabel } from './admin-format';
import { ShareLink } from './share-link';

export function shareMessage(link: InviteLinkResponse): string {
  const who = link.invite.name?.trim();
  if (link.invite.type === 'reset') {
    return `${who ? `Hi ${who}! ` : ''}Here is your FoodLog password reset link. It works once:`;
  }
  return `${who ? `Hi ${who}! ` : ''}Here is your invite to FoodLog. Open it to set your password:`;
}

@Component({
  selector: 'app-link-sheet',
  imports: [BottomSheet, Icon, ShareLink],
  template: `
    <app-bottom-sheet [(open)]="open" [title]="heading()">
      @if (link(); as current) {
        <div class="flex flex-col gap-4">
          <div class="flex items-start gap-3">
            <span
              class="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-brand"
              aria-hidden="true"
            >
              <app-icon name="check" [size]="22" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-fg">{{ intro() || defaultIntro() }}</p>
              <p class="mt-0.5 truncate text-sm text-muted">{{ current.invite.email }}</p>
            </div>
          </div>
          <app-share-link
            caption="Personal link — anyone with it can use it"
            [url]="current.url"
            [title]="current.invite.type === 'reset' ? 'FoodLog password reset' : 'FoodLog invite'"
            [text]="message()"
          />
          <ul class="flex flex-col gap-2 text-sm leading-snug text-muted">
            <li class="flex items-start gap-2">
              <app-icon class="mt-0.5" name="clock" [size]="16" />
              <span>{{ expiry() }} · works once</span>
            </li>
            @if (note()) {
              <li class="flex items-start gap-2">
                <app-icon class="mt-0.5" name="info" [size]="16" />
                <span>{{ note() }}</span>
              </li>
            }
          </ul>
          <button type="button" class="btn btn-secondary min-h-12 w-full" (click)="open.set(false)">
            Done
          </button>
        </div>
      }
    </app-bottom-sheet>
  `,
})
export class LinkSheet {
  readonly open = model(false);
  readonly link = input<InviteLinkResponse | null>(null);
  readonly heading = input('Link ready');
  readonly intro = input('');
  readonly note = input('');

  protected readonly message = computed(() => {
    const link = this.link();
    return link ? shareMessage(link) : '';
  });
  protected readonly defaultIntro = computed(() => {
    const link = this.link();
    if (!link) {
      return '';
    }
    const who = personLabel(link.invite);
    return link.invite.type === 'reset'
      ? `Send ${who} this reset link`
      : `Send ${who} this invite link`;
  });
  protected readonly expiry = computed(() => expiryLabel(this.link()?.invite.expiresAt));
}
