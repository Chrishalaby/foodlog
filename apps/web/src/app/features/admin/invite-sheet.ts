import { Component, computed, effect, inject, model, signal, untracked } from '@angular/core';
import {
  FormField,
  FormRoot,
  type TreeValidationResult,
  email,
  form,
  maxLength,
  required,
} from '@angular/forms/signals';
import { API_LIMITS, type InviteLinkResponse, type UserRole } from '@food/shared';
import { errorMessage, httpStatus } from '../../core/errors';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { Icon } from '../../shared/ui/icon';
import { SegmentedControl, type SegmentOption } from '../../shared/ui/segmented-control';
import { Spinner } from '../../shared/ui/spinner';
import { FormAlert } from '../auth/form-alert';
import { AdminStore } from './admin.store';
import { expiryLabel } from './admin-format';
import { shareMessage } from './link-sheet';
import { ShareLink } from './share-link';

interface InviteModel {
  email: string;
  name: string;
}

const EMPTY_INVITE: InviteModel = { email: '', name: '' };

export const ROLE_OPTIONS: readonly SegmentOption<UserRole>[] = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
];

@Component({
  selector: 'app-invite-sheet',
  imports: [
    BottomSheet,
    FormField,
    FormRoot,
    FormAlert,
    Icon,
    SegmentedControl,
    Spinner,
    ShareLink,
  ],
  template: `
    <app-bottom-sheet
      [(open)]="open"
      [title]="link() ? 'Invite ready' : 'Invite someone'"
      (closed)="reset()"
    >
      @if (link(); as current) {
        <div class="flex flex-col gap-4">
          <p class="text-sm leading-relaxed text-muted">
            Send this personal link to
            <span class="font-semibold text-fg">{{ current.invite.email }}</span
            >. Opening it lets them set a password and start logging right away.
          </p>
          <app-share-link
            caption="Invite link — anyone with it can join"
            title="FoodLog invite"
            [url]="current.url"
            [text]="message()"
          />
          <p class="flex items-center gap-2 text-sm text-muted">
            <app-icon name="clock" [size]="16" />
            {{ expiry() }} · works once
          </p>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn btn-secondary min-h-12" (click)="inviteAnother()">
              Invite another
            </button>
            <button type="button" class="btn btn-primary min-h-12" (click)="open.set(false)">
              Done
            </button>
          </div>
        </div>
      } @else {
        <form class="flex flex-col gap-4" [formRoot]="inviteForm" aria-label="Invite someone">
          <p class="text-sm leading-relaxed text-muted">
            Create a personal invite link, then send it on WhatsApp or any app. No email is sent.
          </p>
          @if (error(); as message) {
            <app-form-alert [message]="message" />
          }
          <div>
            <label class="label" for="invite-email">Email</label>
            <input
              id="invite-email"
              class="input"
              type="email"
              inputmode="email"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="friend@example.com"
              enterkeyhint="next"
              [formField]="inviteForm.email"
              [attr.aria-invalid]="inviteForm.email().touched() && inviteForm.email().invalid()"
            />
            @if (inviteForm.email().touched() && inviteForm.email().errors()[0]; as err) {
              <p class="mt-1.5 text-xs text-danger">{{ err.message }}</p>
            }
          </div>
          <div>
            <label class="label" for="invite-name"
              >Name <span class="font-normal">(optional)</span></label
            >
            <input
              id="invite-name"
              class="input"
              autocomplete="off"
              autocapitalize="words"
              placeholder="Used to greet them"
              enterkeyhint="done"
              [formField]="inviteForm.name"
              [attr.aria-invalid]="inviteForm.name().touched() && inviteForm.name().invalid()"
            />
            @if (inviteForm.name().touched() && inviteForm.name().errors()[0]; as err) {
              <p class="mt-1.5 text-xs text-danger">{{ err.message }}</p>
            }
          </div>
          <div>
            <p class="label" id="invite-role-label">Role</p>
            <app-segmented-control ariaLabel="Role" [options]="roleOptions" [(value)]="role" />
            <p class="mt-1.5 text-xs leading-snug text-muted">{{ roleHint() }}</p>
          </div>
          <button
            type="submit"
            class="btn btn-primary min-h-12 w-full text-base"
            [disabled]="inviteForm().submitting()"
          >
            @if (inviteForm().submitting()) {
              <app-spinner [size]="18" label="Creating invite" />
            }
            Create invite link
          </button>
        </form>
      }
    </app-bottom-sheet>
  `,
})
export class InviteSheet {
  private readonly store = inject(AdminStore);

  readonly open = model(false);

  protected readonly roleOptions = ROLE_OPTIONS;
  protected readonly role = signal<UserRole>('member');
  protected readonly link = signal<InviteLinkResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly model = signal<InviteModel>({ ...EMPTY_INVITE });
  protected readonly inviteForm = form(
    this.model,
    (path) => {
      required(path.email, { message: 'Enter their email address.' });
      email(path.email, { message: 'Enter a valid email address.' });
      maxLength(path.name, API_LIMITS.personNameMax, {
        message: `Use at most ${API_LIMITS.personNameMax} characters.`,
      });
    },
    { submission: { action: async () => this.create() } },
  );
  protected readonly message = computed(() => {
    const link = this.link();
    return link ? shareMessage(link) : '';
  });
  protected readonly expiry = computed(() => expiryLabel(this.link()?.invite.expiresAt));
  protected readonly roleHint = computed(() =>
    this.role() === 'admin'
      ? 'Admins can approve requests, invite people and manage everyone’s access.'
      : 'Members log their own food. They can’t see anyone else’s data.',
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.error.set(null));
      }
    });
  }

  protected inviteAnother(): void {
    this.reset();
  }

  protected reset(): void {
    this.link.set(null);
    this.error.set(null);
    this.role.set('member');
    this.model.set({ ...EMPTY_INVITE });
    this.inviteForm().reset();
  }

  private async create(): Promise<TreeValidationResult> {
    this.error.set(null);
    const value = this.model();
    const name = value.name.trim();
    try {
      const link = await this.store.createInvite({
        email: value.email.trim(),
        name: name.length > 0 ? name : null,
        role: this.role(),
      });
      this.link.set(link);
      return undefined;
    } catch (err) {
      if (httpStatus(err) === 409) {
        return [
          {
            fieldTree: this.inviteForm.email,
            kind: 'server',
            message: errorMessage(err, 'Someone with this email already has an account.'),
          },
        ];
      }
      this.error.set(errorMessage(err, 'Could not create the invite.'));
      return undefined;
    }
  }
}
