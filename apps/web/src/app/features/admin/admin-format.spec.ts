import {
  budgetChanged,
  budgetChoiceOf,
  budgetRequest,
  budgetSummary,
  effectiveBudgetOf,
  effectiveBudgetText,
  emailsMatch,
  expiryLabel,
  filterPeople,
  initials,
  inviteStatusLabel,
  inviteStatusOf,
  parseBudgetInput,
  personLabel,
  sortPeople,
  splitInvites,
  splitRequests,
  timeAgo,
} from './admin-format';
import { toInviteRow } from './invites-tab';
import { accessRequest, adminInvite, adminUser } from './testing/admin-fixtures';

const NOW = new Date('2026-09-28T12:00:00.000Z').getTime();
const H = 3_600_000;
const D = 24 * H;
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

describe('admin-format', () => {
  it('describes how long ago something happened', () => {
    expect(timeAgo(null, NOW)).toBe('never');
    expect(timeAgo(iso(-20_000), NOW)).toBe('just now');
    expect(timeAgo(iso(-5 * 60_000), NOW)).toBe('5 min ago');
    expect(timeAgo(iso(-3 * H), NOW)).toBe('3 h ago');
    expect(timeAgo(iso(-30 * H), NOW)).toBe('yesterday');
    expect(timeAgo(iso(-4 * D), NOW)).toBe('4 days ago');
    expect(timeAgo('2026-09-01T10:00:00.000Z', NOW)).toBe('1 Sep');
    expect(timeAgo('2025-12-24T10:00:00.000Z', NOW)).toBe('24 Dec 2025');
    expect(timeAgo('garbage', NOW)).toBe('never');
  });

  it('describes when a link expires', () => {
    expect(expiryLabel(iso(-H), NOW)).toBe('Expired');
    expect(expiryLabel(iso(20 * 60_000), NOW)).toBe('Expires in under an hour');
    expect(expiryLabel(iso(5 * H), NOW)).toBe('Expires in 5 h');
    expect(expiryLabel(iso(D + H), NOW)).toBe('Expires tomorrow');
    expect(expiryLabel(iso(14 * D), NOW)).toBe('Expires in 14 days');
    expect(expiryLabel(null, NOW)).toBe('');
  });

  it('labels people by name, falling back to email, with initials', () => {
    expect(personLabel({ name: ' Maya ', email: 'm@example.com' })).toBe('Maya');
    expect(personLabel({ name: null, email: 'm@example.com' })).toBe('m@example.com');
    expect(initials({ name: 'Maya Haddad', email: 'm@example.com' })).toBe('MH');
    expect(initials({ name: null, email: 'karim.saleh@example.com' })).toBe('KS');
    expect(initials({ name: 'rana', email: 'r@example.com' })).toBe('RA');
  });

  it('parses budget input and maps the budget choice to the request', () => {
    expect(parseBudgetInput('7.5')).toBe(7.5);
    expect(parseBudgetInput(' $12,25 ')).toBe(12.25);
    expect(parseBudgetInput('0')).toBe(0);
    expect(parseBudgetInput('1.234')).toBeNull();
    expect(parseBudgetInput('-1')).toBeNull();
    expect(parseBudgetInput('abc')).toBeNull();
    expect(parseBudgetInput('10000.01')).toBeNull();
    expect(parseBudgetInput('10000')).toBe(10_000);
    expect(budgetRequest('default', 3)).toEqual({
      aiBudgetUnlimited: false,
      aiMonthlyBudgetUsd: null,
    });
    expect(budgetRequest('custom', 3)).toEqual({ aiBudgetUnlimited: false, aiMonthlyBudgetUsd: 3 });
    expect(budgetRequest('custom', null)).toBeNull();
    expect(budgetRequest('unlimited', 3)).toEqual({ aiBudgetUnlimited: true });
  });

  it('reads the budget choice from the unlimited flag, never from a sentinel amount', () => {
    expect(budgetChoiceOf({ aiBudgetUnlimited: false, aiMonthlyBudgetUsd: null })).toBe('default');
    expect(budgetChoiceOf({ aiBudgetUnlimited: false, aiMonthlyBudgetUsd: 8 })).toBe('custom');
    expect(budgetChoiceOf({ aiBudgetUnlimited: false, aiMonthlyBudgetUsd: 10_000 })).toBe('custom');
    expect(budgetChoiceOf({ aiBudgetUnlimited: true, aiMonthlyBudgetUsd: 8 })).toBe('unlimited');
  });

  it('knows when a budget request changes anything', () => {
    const custom = { aiBudgetUnlimited: false, aiMonthlyBudgetUsd: 8 };
    const unlimited = { aiBudgetUnlimited: true, aiMonthlyBudgetUsd: 8 };
    expect(budgetChanged(custom, { aiBudgetUnlimited: false, aiMonthlyBudgetUsd: 8 })).toBe(false);
    expect(budgetChanged(custom, { aiBudgetUnlimited: false, aiMonthlyBudgetUsd: 9 })).toBe(true);
    expect(budgetChanged(custom, { aiBudgetUnlimited: true })).toBe(true);
    expect(budgetChanged(unlimited, { aiBudgetUnlimited: true })).toBe(false);
    expect(budgetChanged(unlimited, { aiBudgetUnlimited: false, aiMonthlyBudgetUsd: 8 })).toBe(
      true,
    );
  });

  it('works out the effective budget like the server', () => {
    const member = adminUser({ id: 'a' });
    const admin = adminUser({ id: 'b', role: 'admin' });
    expect(effectiveBudgetOf(member, 5)).toBe(5);
    expect(effectiveBudgetOf(member, null)).toBeNull();
    expect(effectiveBudgetOf(admin, 5)).toBeNull();
    expect(effectiveBudgetOf({ ...admin, aiMonthlyBudgetUsd: 20 }, 5)).toBe(20);
    expect(effectiveBudgetOf({ ...member, aiMonthlyBudgetUsd: 0 }, 5)).toBe(0);
    expect(
      effectiveBudgetOf({ ...member, aiMonthlyBudgetUsd: 20, aiBudgetUnlimited: true }, 5),
    ).toBe(null);
  });

  it('describes the effective budget', () => {
    expect(effectiveBudgetText(adminUser({ id: 'a', effectiveBudgetUsd: 5 }))).toBe(
      'of $5.00 this month',
    );
    expect(effectiveBudgetText(adminUser({ id: 'a', effectiveBudgetUsd: null }))).toBe(
      'No monthly limit',
    );
    expect(
      effectiveBudgetText(
        adminUser({ id: 'a', effectiveBudgetUsd: null, aiBudgetUnlimited: true }),
      ),
    ).toBe('Unlimited · no monthly limit');
  });

  it('summarises the budget setting per person', () => {
    expect(budgetSummary(adminUser({ id: 'a' }), 5)).toBe('Default · $5.00 a month');
    expect(budgetSummary(adminUser({ id: 'a', role: 'admin' }), 5)).toBe(
      'Default · No limit (admin default)',
    );
    expect(budgetSummary(adminUser({ id: 'a', aiMonthlyBudgetUsd: 12 }), 5)).toBe('$12.00 a month');
    expect(budgetSummary(adminUser({ id: 'a', aiMonthlyBudgetUsd: 10_000 }), 5)).toBe(
      '$10,000.00 a month',
    );
    expect(budgetSummary(adminUser({ id: 'a', aiBudgetUnlimited: true }), 5)).toBe('Unlimited');
  });

  it('sorts people: you first, active before disabled, then most recently seen', () => {
    const people = [
      adminUser({ id: 'old', lastSeenAt: iso(-10 * D) }),
      adminUser({ id: 'off', status: 'disabled', lastSeenAt: iso(-60_000) }),
      adminUser({ id: 'me', isSelf: true, lastSeenAt: iso(-20 * D) }),
      adminUser({ id: 'new', lastSeenAt: iso(-60_000) }),
    ];
    expect(sortPeople(people).map((p) => p.id)).toEqual(['me', 'new', 'old', 'off']);
    expect(filterPeople(people, ' NEW ').map((p) => p.id)).toEqual(['new']);
    expect(filterPeople(people, '').length).toBe(4);
  });

  it('splits requests into pending (newest first) and decided', () => {
    const groups = splitRequests([
      accessRequest({ id: 'a', createdAt: iso(-3 * H) }),
      accessRequest({ id: 'b', status: 'rejected', decidedAt: iso(-D) }),
      accessRequest({ id: 'c', createdAt: iso(-H) }),
      accessRequest({ id: 'd', status: 'approved', decidedAt: iso(-H) }),
    ]);
    expect(groups.pending.map((r) => r.id)).toEqual(['c', 'a']);
    expect(groups.decided.map((r) => r.id)).toEqual(['d', 'b']);
  });

  it('treats pending invites past their expiry as expired', () => {
    expect(inviteStatusOf(adminInvite({ id: 'a', expiresAt: iso(-60_000) }), NOW)).toBe('expired');
    expect(inviteStatusOf(adminInvite({ id: 'b', expiresAt: iso(5 * D) }), NOW)).toBe('pending');
    const groups = splitInvites(
      [
        adminInvite({ id: 'a', expiresAt: iso(-60_000) }),
        adminInvite({ id: 'b', expiresAt: iso(5 * D) }),
        adminInvite({ id: 'c', status: 'used', expiresAt: iso(5 * D) }),
      ],
      NOW,
    );
    expect(groups.pending.map((i) => i.id)).toEqual(['b']);
    expect(groups.past.map((i) => i.id).sort()).toEqual(['a', 'c']);
  });

  it('labels a used password reset link as a password set, not a new member', () => {
    expect(inviteStatusLabel(adminInvite({ id: 'r', type: 'reset' }), 'used')).toBe('Password set');
    expect(inviteStatusLabel(adminInvite({ id: 'i', type: 'invite' }), 'used')).toBe('Joined');
    expect(inviteStatusLabel(adminInvite({ id: 'r2', type: 'reset' }), 'pending')).toBe('Waiting');
    expect(inviteStatusLabel(adminInvite({ id: 'r3', type: 'reset' }), 'expired')).toBe('Expired');
    expect(inviteStatusLabel(adminInvite({ id: 'r4', type: 'reset' }), 'revoked')).toBe('Revoked');
  });

  it('never calls a used reset link joined in the past links list', () => {
    const used = toInviteRow(
      adminInvite({ id: 'r', type: 'reset', status: 'used', usedAt: iso(-60_000) }),
      NOW,
    );
    expect(used.statusLabel).toBe('Password set');
    expect(used.detail.startsWith('Used ')).toBe(true);
    expect(used.detail).not.toContain('Joined');

    const undated = toInviteRow(
      adminInvite({ id: 'r2', type: 'reset', status: 'used', usedAt: null }),
      NOW,
    );
    expect(undated.detail).not.toContain('Joined');
    expect(undated.detail.startsWith('Password set')).toBe(true);

    const joined = toInviteRow(adminInvite({ id: 'i', status: 'used', usedAt: iso(-60_000) }), NOW);
    expect(joined.statusLabel).toBe('Joined');
  });

  it('matches typed emails loosely but never an empty value', () => {
    expect(emailsMatch(' Maya@Example.com ', 'maya@example.com')).toBe(true);
    expect(emailsMatch('maya@example.co', 'maya@example.com')).toBe(false);
    expect(emailsMatch('', '')).toBe(false);
  });
});
