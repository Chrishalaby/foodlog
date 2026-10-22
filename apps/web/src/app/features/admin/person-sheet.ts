import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { InviteLinkResponse, UserRole } from '@food/shared';
import { errorMessage } from '../../core/errors';
import { ToastService } from '../../core/toast.service';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { Icon } from '../../shared/ui/icon';
import { SegmentedControl, type SegmentOption } from '../../shared/ui/segmented-control';
import { Spinner } from '../../shared/ui/spinner';
import { formatNumber } from '../../shared/utils/format';
import { budgetStatus, formatUsd } from '../settings/usage-math';
import { AdminStore } from './admin.store';
import {
  BUDGET_MAX_USD,
  type BudgetChoice,
  budgetChanged,
  budgetChoiceOf,
  budgetRequest,
  calendarLabel,
  defaultBudgetLabel,
  effectiveBudgetText,
  emailsMatch,
  expiryLabel,
  initials,
  parseBudgetInput,
  personLabel,
  timeAgo,
} from './admin-format';
import { shareMessage } from './link-sheet';
import { ShareLink } from './share-link';

interface BudgetSource {
  id: string;
  unlimited: boolean;
  value: number | null;
}

export type PersonAction = 'budget' | 'role' | 'status' | 'reset' | 'sessions' | 'delete';

export const BUDGET_INVALID_MESSAGE = `Enter an amount from $0 to $${BUDGET_MAX_USD.toLocaleString('en-US')}, or choose Unlimited.`;

const BUDGET_OPTIONS: readonly SegmentOption<BudgetChoice>[] = [
  { value: 'default', label: 'Default' },
  { value: 'custom', label: 'Custom' },
  { value: 'unlimited', label: 'Unlimited' },
];

const BAR_CLASSES = { ok: 'bg-brand', warn: 'bg-warn', over: 'bg-danger' } as const;

@Component({
  selector: 'app-person-sheet',
  imports: [BottomSheet, Icon, RouterLink, SegmentedControl, Spinner, ShareLink],
  templateUrl: './person-sheet.html',
})
export class PersonSheet {
  private readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly open = model(false);
  readonly personId = input<string | null>(null);

  protected readonly budgetOptions = BUDGET_OPTIONS;
  protected readonly person = computed(() => this.store.userById(this.personId()));
  protected readonly busy = signal<PersonAction | null>(null);
  protected readonly resetLink = signal<InviteLinkResponse | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly deleteTyped = signal('');
  protected readonly budgetError = signal<string | null>(null);
  private readonly savedBudget = computed<BudgetSource | null>(
    () => {
      const person = this.person();
      return person
        ? {
            id: person.id,
            unlimited: person.aiBudgetUnlimited,
            value: person.aiMonthlyBudgetUsd,
          }
        : null;
    },
    {
      equal: (a, b) => a?.id === b?.id && a?.unlimited === b?.unlimited && a?.value === b?.value,
    },
  );
  protected readonly budgetChoice = linkedSignal<BudgetSource | null, BudgetChoice>({
    source: this.savedBudget,
    computation: (saved) =>
      budgetChoiceOf({
        aiBudgetUnlimited: saved?.unlimited ?? false,
        aiMonthlyBudgetUsd: saved?.value ?? null,
      }),
  });
  protected readonly budgetText = linkedSignal<BudgetSource | null, string>({
    source: this.savedBudget,
    computation: (saved) => (saved?.value == null ? '' : String(saved.value)),
  });

  protected readonly title = computed(() => {
    const person = this.person();
    return person ? personLabel(person) : 'Person';
  });
  protected readonly avatar = computed(() => {
    const person = this.person();
    return person ? initials(person) : '';
  });
  protected readonly memberDefault = computed(
    () => this.store.overview()?.memberDefaultBudgetUsd ?? null,
  );
  protected readonly stats = computed(() => {
    const person = this.person();
    if (!person) {
      return [];
    }
    return [
      { label: 'Entries', value: formatNumber(person.entryCount) },
      { label: 'Devices', value: formatNumber(person.activeSessions) },
      { label: 'Last seen', value: person.lastSeenAt ? timeAgo(person.lastSeenAt) : 'Never' },
    ];
  });
  protected readonly joined = computed(() => {
    const person = this.person();
    return person ? `Joined ${calendarLabel(person.createdAt)}` : '';
  });
  protected readonly usage = computed(() => {
    const person = this.person();
    if (!person) {
      return null;
    }
    const status = budgetStatus(person.aiCostMonthUsd, person.effectiveBudgetUsd);
    return {
      cost: formatUsd(person.aiCostMonthUsd),
      requests: `${formatNumber(person.aiRequestsMonth)} ${person.aiRequestsMonth === 1 ? 'request' : 'requests'}`,
      status,
      barClass: status ? BAR_CLASSES[status.level] : '',
      of: effectiveBudgetText(person),
    };
  });
  protected readonly budgetHint = computed(() => {
    const person = this.person();
    switch (this.budgetChoice()) {
      case 'default':
        return `Follows the default: ${defaultBudgetLabel(person?.role ?? 'member', this.memberDefault())}.`;
      case 'unlimited':
        return 'No personal limit. The global AI budget still applies.';
      default:
        return 'AI analyses pause for them once this month’s cost reaches this amount.';
    }
  });
  protected readonly requestedBudget = computed(() =>
    budgetRequest(this.budgetChoice(), parseBudgetInput(this.budgetText())),
  );
  protected readonly budgetDirty = computed(() => {
    const person = this.person();
    if (!person) {
      return false;
    }
    const request = this.requestedBudget();
    if (request === null) {
      return this.budgetText().trim().length > 0 || budgetChoiceOf(person) !== 'custom';
    }
    return budgetChanged(person, request);
  });
  protected readonly deleteConfirmed = computed(() => {
    const person = this.person();
    return person !== null && emailsMatch(this.deleteTyped(), person.email);
  });
  protected readonly resetExpiry = computed(() => expiryLabel(this.resetLink()?.invite.expiresAt));
  protected readonly resetMessage = computed(() => {
    const link = this.resetLink();
    return link ? shareMessage(link) : '';
  });

  constructor() {
    effect(() => {
      this.personId();
      untracked(() => this.clearTransient());
    });
    effect(() => {
      if (this.open() && this.personId() !== null && this.person() === null) {
        untracked(() => this.open.set(false));
      }
    });
  }

  protected onBudgetInput(event: Event): void {
    this.budgetText.set((event.target as HTMLInputElement).value);
    this.budgetError.set(null);
  }

  protected async saveBudget(): Promise<void> {
    const person = this.person();
    if (!person || this.busy()) {
      return;
    }
    const request = this.requestedBudget();
    if (request === null) {
      this.budgetError.set(BUDGET_INVALID_MESSAGE);
      return;
    }
    await this.run('budget', async () => {
      await this.store.updateUser(person.id, request);
      this.toast.success(`AI budget updated for ${personLabel(person)}.`);
    });
  }

  protected async changeRole(role: UserRole): Promise<void> {
    const person = this.person();
    if (!person || person.isSelf || person.role === role) {
      return;
    }
    const promote = role === 'admin';
    const confirmed = await this.confirm.confirm({
      title: promote
        ? `Make ${personLabel(person)} an admin?`
        : `Make ${personLabel(person)} a member?`,
      message: promote
        ? 'Admins can approve requests, invite and remove people, and see everyone’s usage totals. They never see other people’s food.'
        : 'They will lose access to this admin panel.',
      confirmLabel: promote ? 'Make admin' : 'Make member',
    });
    if (!confirmed) {
      return;
    }
    await this.run('role', async () => {
      await this.store.updateUser(person.id, { role });
      this.toast.success(`${personLabel(person)} is now ${promote ? 'an admin' : 'a member'}.`);
    });
  }

  protected async toggleStatus(): Promise<void> {
    const person = this.person();
    if (!person || person.isSelf) {
      return;
    }
    const disabling = person.status === 'active';
    if (disabling) {
      const confirmed = await this.confirm.confirm({
        title: `Disable ${personLabel(person)}?`,
        message:
          'They are signed out on every device and cannot sign in until you enable them again. Their data is kept.',
        confirmLabel: 'Disable',
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }
    await this.run('status', async () => {
      await this.store.updateUser(person.id, { status: disabling ? 'disabled' : 'active' });
      this.toast.success(
        disabling
          ? `${personLabel(person)} is disabled.`
          : `${personLabel(person)} can sign in again.`,
      );
    });
  }

  protected async createResetLink(): Promise<void> {
    const person = this.person();
    if (!person || person.isSelf) {
      return;
    }
    await this.run('reset', async () => {
      this.resetLink.set(await this.store.resetLink(person.id));
    });
  }

  protected async signOutEverywhere(): Promise<void> {
    const person = this.person();
    if (!person || person.isSelf) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: `Sign ${personLabel(person)} out everywhere?`,
      message: 'Every device they use will need their password again.',
      confirmLabel: 'Sign out',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await this.run('sessions', async () => {
      await this.store.revokeSessions(person.id);
      this.toast.success(`${personLabel(person)} is signed out everywhere.`);
    });
  }

  protected toggleDelete(): void {
    this.deleteOpen.update((open) => !open);
    this.deleteTyped.set('');
  }

  protected onDeleteInput(event: Event): void {
    this.deleteTyped.set((event.target as HTMLInputElement).value);
  }

  protected async deleteAccount(): Promise<void> {
    const person = this.person();
    if (!person || person.isSelf || !this.deleteConfirmed()) {
      return;
    }
    await this.run('delete', async () => {
      await this.store.deleteUser(person.id);
      this.toast.success(`Deleted ${personLabel(person)} and all their data.`);
      this.open.set(false);
    });
  }

  protected onClosed(): void {
    this.clearTransient();
  }

  private async run(action: PersonAction, task: () => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(action);
    try {
      await task();
    } catch (err) {
      this.toast.error(errorMessage(err, 'That did not work. Please try again.'));
    } finally {
      this.busy.set(null);
    }
  }

  private clearTransient(): void {
    this.resetLink.set(null);
    this.deleteOpen.set(false);
    this.deleteTyped.set('');
    this.budgetError.set(null);
  }
}
