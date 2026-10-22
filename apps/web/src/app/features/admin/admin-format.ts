import type {
  AdminAccessRequestDto,
  AdminInviteDto,
  AdminInviteStatus,
  AdminUserDto,
  UpdateAdminUserRequest,
} from '@food/shared';
import { MONTH_SHORT } from '../../core/time';
import { formatUsd } from '../settings/usage-math';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const BUDGET_MAX_USD = 10_000;

export type BudgetChoice = 'default' | 'custom' | 'unlimited';

export type BudgetSettings = Pick<AdminUserDto, 'aiBudgetUnlimited' | 'aiMonthlyBudgetUsd'>;

export type BudgetRequest = Required<Pick<UpdateAdminUserRequest, 'aiBudgetUnlimited'>> &
  Pick<UpdateAdminUserRequest, 'aiMonthlyBudgetUsd'>;

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) {
    return null;
  }
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
}

export function calendarLabel(iso: string, now: number = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const label = `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear()
    ? label
    : `${label} ${date.getFullYear()}`;
}

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  const time = parseTime(iso);
  if (time === null) {
    return 'never';
  }
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) {
    return 'just now';
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  }
  if (elapsed < 2 * DAY_MS) {
    return 'yesterday';
  }
  if (elapsed < 7 * DAY_MS) {
    return `${Math.floor(elapsed / DAY_MS)} days ago`;
  }
  return calendarLabel(iso as string, now);
}

export function expiryLabel(iso: string | null | undefined, now: number = Date.now()): string {
  const time = parseTime(iso);
  if (time === null) {
    return '';
  }
  const remaining = time - now;
  if (remaining <= 0) {
    return 'Expired';
  }
  if (remaining < HOUR_MS) {
    return 'Expires in under an hour';
  }
  if (remaining < DAY_MS) {
    const hours = Math.floor(remaining / HOUR_MS);
    return `Expires in ${hours} h`;
  }
  const days = Math.round(remaining / DAY_MS);
  return days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
}

export function personLabel(person: { name: string | null; email: string }): string {
  const name = person.name?.trim();
  return name ? name : person.email;
}

export function initials(person: { name: string | null; email: string }): string {
  const source = person.name?.trim() || person.email.split('@')[0] || person.email;
  const words = source
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  const letters =
    words.length >= 2 ? `${words[0][0]}${words[words.length - 1][0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

export function budgetChoiceOf(settings: BudgetSettings): BudgetChoice {
  if (settings.aiBudgetUnlimited) {
    return 'unlimited';
  }
  return settings.aiMonthlyBudgetUsd === null ? 'default' : 'custom';
}

export function parseBudgetInput(text: string): number | null {
  const normalized = text.trim().replace(/^\$/, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 && value <= BUDGET_MAX_USD ? value : null;
}

export function budgetRequest(choice: BudgetChoice, custom: number | null): BudgetRequest | null {
  switch (choice) {
    case 'default':
      return { aiBudgetUnlimited: false, aiMonthlyBudgetUsd: null };
    case 'unlimited':
      return { aiBudgetUnlimited: true };
    default:
      return custom === null ? null : { aiBudgetUnlimited: false, aiMonthlyBudgetUsd: custom };
  }
}

export function budgetChanged(settings: BudgetSettings, request: BudgetRequest): boolean {
  if (request.aiBudgetUnlimited !== settings.aiBudgetUnlimited) {
    return true;
  }
  return (
    request.aiMonthlyBudgetUsd !== undefined &&
    request.aiMonthlyBudgetUsd !== settings.aiMonthlyBudgetUsd
  );
}

export function effectiveBudgetOf(
  user: Pick<AdminUserDto, 'role' | 'aiBudgetUnlimited' | 'aiMonthlyBudgetUsd'>,
  memberDefaultUsd: number | null,
): number | null {
  if (user.aiBudgetUnlimited) {
    return null;
  }
  if (user.aiMonthlyBudgetUsd !== null) {
    return user.aiMonthlyBudgetUsd;
  }
  return user.role === 'admin' ? null : memberDefaultUsd;
}

export function defaultBudgetLabel(
  role: AdminUserDto['role'],
  memberDefaultUsd: number | null,
): string {
  if (role === 'admin') {
    return 'No limit (admin default)';
  }
  return memberDefaultUsd === null ? 'No limit' : `${formatUsd(memberDefaultUsd)} a month`;
}

export function budgetSummary(user: AdminUserDto, memberDefaultUsd: number | null): string {
  switch (budgetChoiceOf(user)) {
    case 'unlimited':
      return 'Unlimited';
    case 'default':
      return `Default · ${defaultBudgetLabel(user.role, memberDefaultUsd)}`;
    default:
      return `${formatUsd(user.aiMonthlyBudgetUsd ?? 0)} a month`;
  }
}

export function effectiveBudgetText(user: AdminUserDto): string {
  if (user.effectiveBudgetUsd !== null) {
    return `of ${formatUsd(user.effectiveBudgetUsd)} this month`;
  }
  return user.aiBudgetUnlimited ? 'Unlimited · no monthly limit' : 'No monthly limit';
}

function lastSeenTime(user: AdminUserDto): number {
  return parseTime(user.lastSeenAt) ?? parseTime(user.createdAt) ?? 0;
}

export function sortPeople(users: readonly AdminUserDto[]): AdminUserDto[] {
  return [...users].sort((a, b) => {
    if (a.isSelf !== b.isSelf) {
      return a.isSelf ? -1 : 1;
    }
    if (a.status !== b.status) {
      return a.status === 'active' ? -1 : 1;
    }
    return lastSeenTime(b) - lastSeenTime(a) || personLabel(a).localeCompare(personLabel(b), 'en');
  });
}

export function filterPeople(users: readonly AdminUserDto[], query: string): AdminUserDto[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...users];
  }
  return users.filter(
    (user) =>
      user.email.toLowerCase().includes(needle) || (user.name ?? '').toLowerCase().includes(needle),
  );
}

export function splitRequests(requests: readonly AdminAccessRequestDto[]): {
  pending: AdminAccessRequestDto[];
  decided: AdminAccessRequestDto[];
} {
  const byNewest = (a: AdminAccessRequestDto, b: AdminAccessRequestDto): number =>
    (parseTime(b.decidedAt ?? b.createdAt) ?? 0) - (parseTime(a.decidedAt ?? a.createdAt) ?? 0);
  return {
    pending: requests
      .filter((request) => request.status === 'pending')
      .sort((a, b) => (parseTime(b.createdAt) ?? 0) - (parseTime(a.createdAt) ?? 0)),
    decided: requests.filter((request) => request.status !== 'pending').sort(byNewest),
  };
}

export function inviteStatusOf(
  invite: AdminInviteDto,
  now: number = Date.now(),
): AdminInviteStatus {
  if (invite.status !== 'pending') {
    return invite.status;
  }
  const expires = parseTime(invite.expiresAt);
  return expires !== null && expires <= now ? 'expired' : 'pending';
}

export function splitInvites(
  invites: readonly AdminInviteDto[],
  now: number = Date.now(),
): { pending: AdminInviteDto[]; past: AdminInviteDto[] } {
  const newest = (a: AdminInviteDto, b: AdminInviteDto): number =>
    (parseTime(b.createdAt) ?? 0) - (parseTime(a.createdAt) ?? 0);
  return {
    pending: invites.filter((invite) => inviteStatusOf(invite, now) === 'pending').sort(newest),
    past: invites.filter((invite) => inviteStatusOf(invite, now) !== 'pending').sort(newest),
  };
}

export const INVITE_STATUS_LABELS: Record<AdminInviteStatus, string> = {
  pending: 'Waiting',
  used: 'Joined',
  expired: 'Expired',
  revoked: 'Revoked',
};

export function inviteStatusLabel(
  invite: Pick<AdminInviteDto, 'type'>,
  status: AdminInviteStatus,
): string {
  return invite.type === 'reset' && status === 'used'
    ? 'Password set'
    : INVITE_STATUS_LABELS[status];
}

export const INVITE_STATUS_CLASSES: Record<AdminInviteStatus, string> = {
  pending: 'bg-warn/15 text-warn',
  used: 'bg-brand/15 text-brand',
  expired: 'bg-surface-2 text-muted',
  revoked: 'bg-danger/12 text-danger',
};

export function emailsMatch(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase() && typed.trim().length > 0;
}
