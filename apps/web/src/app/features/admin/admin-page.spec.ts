import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Mock } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { AdminPage } from './admin-page';
import { BUDGET_INVALID_MESSAGE } from './person-sheet';
import {
  accessRequest,
  adminApiImpl,
  adminInvite,
  adminOverview,
  adminUser,
  buttonByText,
  installDialogShim,
} from './testing/admin-fixtures';

type AdminApiImpl = ReturnType<typeof adminApiImpl>;
type AdminApiMock = { [K in keyof AdminApiImpl]: Mock<AdminApiImpl[K]> };

function createAdminApi(): AdminApiMock {
  return Object.fromEntries(
    Object.entries(adminApiImpl()).map(([key, fn]) => [key, vi.fn(fn)]),
  ) as unknown as AdminApiMock;
}

const sleep = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}

function openDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>('dialog.sheet[open]');
}

describe('AdminPage', () => {
  let api: AdminApiMock;
  let confirm: Mock<ConfirmService['confirm']>;
  let restoreDialog: () => void;

  beforeAll(() => {
    restoreDialog = installDialogShim();
  });

  afterAll(() => restoreDialog());

  beforeEach(() => {
    api = createAdminApi();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
    confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
  });

  async function settle(fixture: ComponentFixture<AdminPage>): Promise<void> {
    await sleep();
    await fixture.whenStable();
    await sleep();
    await fixture.whenStable();
  }

  async function render(tab?: string) {
    const fixture = TestBed.createComponent(AdminPage);
    if (tab) {
      fixture.componentRef.setInput('tab', tab);
    }
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function toasts(): string[] {
    return TestBed.inject(ToastService)
      .toasts()
      .map((toast) => toast.message);
  }

  it('shows the overview numbers and opens on pending requests', async () => {
    const { el } = await render();
    const overview = el.querySelector('[aria-label="Overview"]')!;
    expect(overview.textContent).toContain('People');
    expect(overview.textContent).toContain('Active 30 d');
    expect(overview.textContent).toContain('$6.50');
    expect(overview.textContent).toContain('of $50.00 global budget');
    expect(overview.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '13',
    );
    const selected = el.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toContain('Requests');
    expect(el.querySelector('[role="tabpanel"]')?.textContent).toContain('lina@example.com');
  });

  it('opens on people when nothing is pending and switches tabs', async () => {
    api.adminAccessRequests.mockResolvedValue([]);
    api.adminOverview.mockResolvedValue(adminOverview({ pendingRequests: 0 }));
    const { fixture, el } = await render();
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('People');
    el.querySelector<HTMLButtonElement>('#admin-tab-invites')!.click();
    await settle(fixture);
    expect(el.querySelector('[role="tabpanel"]')?.textContent).toContain('nour@example.com');
  });

  it('approves a request and shows the invite link to copy or share', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { fixture, el } = await render('requests');
    el.querySelector<HTMLButtonElement>('button[aria-label="Approve Lina"]')!.click();
    await settle(fixture);
    expect(api.adminApproveRequest).toHaveBeenCalledWith('lina');
    const sheet = openDialog()!;
    expect(sheet.textContent).toContain('Lina is approved');
    expect(sheet.textContent).toContain('FoodLog there now says');
    expect(sheet.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(
      'https://food.example.com/invite/token-inv-lina',
    );
    buttonByText(sheet, 'Copy link').click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith('https://food.example.com/invite/token-inv-lina');
    expect(sheet.textContent).toContain('Copied');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('stays on requests with the link open after approving the last pending request', async () => {
    const { fixture, el } = await render();
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      'Requests',
    );
    api.adminAccessRequests.mockResolvedValue([
      accessRequest({
        id: 'lina',
        name: 'Lina',
        status: 'approved',
        decidedAt: new Date().toISOString(),
      }),
    ]);
    api.adminOverview.mockResolvedValue(adminOverview({ pendingRequests: 0 }));
    el.querySelector<HTMLButtonElement>('button[aria-label="Approve Lina"]')!.click();
    await settle(fixture);
    await settle(fixture);
    expect(api.adminOverview).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      'Requests',
    );
    expect(openDialog()?.textContent).toContain('Lina is approved');
  });

  it('asks before rejecting and moves the request to the history', async () => {
    const { fixture, el } = await render('requests');
    confirm.mockResolvedValueOnce(false);
    el.querySelector<HTMLButtonElement>('button[aria-label="Reject Lina"]')!.click();
    await settle(fixture);
    expect(api.adminRejectRequest).not.toHaveBeenCalled();

    api.adminAccessRequests.mockResolvedValue([
      accessRequest({
        id: 'lina',
        name: 'Lina',
        status: 'rejected',
        decidedAt: new Date().toISOString(),
      }),
    ]);
    el.querySelector<HTMLButtonElement>('button[aria-label="Reject Lina"]')!.click();
    await settle(fixture);
    expect(api.adminRejectRequest).toHaveBeenCalledWith('lina');
    expect(el.textContent).toContain('No pending requests');
    expect(el.querySelector('details')?.textContent).toContain('Rejected');
  });

  it('only offers to dismiss requests from people who already have an account', async () => {
    api.adminAccessRequests.mockResolvedValue([
      accessRequest({ id: 'maya', name: 'Maya', hasAccount: true }),
    ]);
    const { el } = await render('requests');
    expect(el.querySelector('button[aria-label="Approve Maya"]')).toBeNull();
    expect(el.querySelector('button[aria-label="Dismiss Maya"]')).not.toBeNull();
  });

  it('records a dismissed request from an existing member as dismissed, not rejected', async () => {
    api.adminAccessRequests.mockResolvedValue([
      accessRequest({
        id: 'maya-again',
        name: 'Maya Again',
        email: 'maya@example.com',
        status: 'rejected',
        hasAccount: true,
        decidedAt: new Date().toISOString(),
      }),
      accessRequest({
        id: 'lina',
        name: 'Lina',
        status: 'rejected',
        decidedAt: new Date().toISOString(),
      }),
    ]);
    const { el } = await render('requests');
    const rows = Array.from(el.querySelectorAll('details li'));
    const maya = rows.find((row) => row.textContent?.includes('Maya Again'))!;
    const lina = rows.find((row) => row.textContent?.includes('Lina'))!;
    expect(maya.textContent).toContain('Dismissed');
    expect(maya.textContent).not.toContain('Rejected');
    expect(maya.querySelector('.chip')?.className).not.toContain('text-danger');
    expect(lina.textContent).toContain('Rejected');
  });

  it('sends a password reset link to a member who asked for access again', async () => {
    api.adminAccessRequests.mockResolvedValue([
      accessRequest({ id: 'req-maya', name: 'Maya', email: 'MAYA@example.com', hasAccount: true }),
    ]);
    const { fixture, el } = await render('requests');
    el.querySelector<HTMLButtonElement>('button[aria-label="Send reset link to Maya"]')!.click();
    await settle(fixture);
    expect(api.adminResetLink).toHaveBeenCalledWith('maya');
    expect(api.adminRejectRequest).not.toHaveBeenCalled();
    const sheet = openDialog()!;
    expect(sheet.textContent).toContain('Password reset link');
    expect(sheet.textContent).not.toContain('is approved');
    expect(sheet.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(
      'https://food.example.com/reset/token-reset-maya',
    );
    expect(el.querySelector('button[aria-label="Dismiss Maya"]')).not.toBeNull();
  });

  it('explains when a reset link for a waiting member cannot be created', async () => {
    api.adminAccessRequests.mockResolvedValue([
      accessRequest({ id: 'req-maya', name: 'Maya', email: 'maya@example.com', hasAccount: true }),
    ]);
    api.adminResetLink.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const { fixture, el } = await render('requests');
    el.querySelector<HTMLButtonElement>('button[aria-label="Send reset link to Maya"]')!.click();
    await settle(fixture);
    expect(toasts()).toContain('Could not create a reset link for Maya.');
    expect(openDialog()).toBeNull();
    expect(
      el.querySelector<HTMLButtonElement>('button[aria-label="Send reset link to Maya"]')!.disabled,
    ).toBe(false);
  });

  it('only offers a reset link when the matching account is active', async () => {
    api.adminAccessRequests.mockResolvedValue([
      accessRequest({ id: 'req-rana', name: 'Rana', email: 'rana@example.com', hasAccount: true }),
      accessRequest({ id: 'req-omar', name: 'Omar', email: 'omar@example.com', hasAccount: true }),
    ]);
    api.adminUsers.mockResolvedValue([adminUser({ id: 'rana', status: 'disabled' })]);
    const { el } = await render('requests');
    expect(el.querySelector('button[aria-label="Send reset link to Rana"]')).toBeNull();
    expect(el.querySelector('button[aria-label="Send reset link to Omar"]')).toBeNull();
    expect(el.querySelector('button[aria-label="Dismiss Rana"]')).not.toBeNull();
    expect(el.querySelector('button[aria-label="Dismiss Omar"]')).not.toBeNull();
  });

  async function openPerson(id: string) {
    const page = await render('people');
    page.el.querySelector<HTMLButtonElement>(`button[data-person="${id}"]`)!.click();
    await settle(page.fixture);
    return { ...page, sheet: openDialog()! };
  }

  it('lists people with their usage against the budget', async () => {
    api.adminUsers.mockResolvedValue([
      adminUser({
        id: 'me',
        isSelf: true,
        role: 'admin',
        effectiveBudgetUsd: null,
        aiCostMonthUsd: 2,
      }),
      adminUser({ id: 'maya', name: 'Maya', aiCostMonthUsd: 4, entryCount: 12, activeSessions: 2 }),
      adminUser({ id: 'rana', status: 'disabled' }),
      adminUser({
        id: 'omar',
        aiBudgetUnlimited: true,
        effectiveBudgetUsd: null,
        aiCostMonthUsd: 7,
        lastSeenAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      }),
    ]);
    const { el } = await render('people');
    const rows = Array.from(el.querySelectorAll('button[data-person]'));
    expect(rows.map((row) => row.getAttribute('data-person'))).toEqual([
      'me',
      'maya',
      'omar',
      'rana',
    ]);
    expect(rows[0].textContent).toContain('You');
    expect(rows[0].textContent).toContain('$2.00 · no limit');
    expect(rows[1].textContent).toContain('$4.00 of $5.00');
    expect(rows[1].textContent).toContain('12 entries · 2 devices');
    expect(rows[2].textContent).toContain('$7.00 · unlimited');
    expect(rows[3].textContent).toContain('Disabled');
  });

  function budgetButton(sheet: HTMLElement, label: string): HTMLButtonElement {
    return Array.from(
      sheet.querySelectorAll<HTMLButtonElement>('[aria-label="Monthly AI budget"] button'),
    ).find((b) => b.textContent?.trim() === label)!;
  }

  it('sets a custom, unlimited or default AI budget with the unlimited flag', async () => {
    const { fixture, sheet } = await openPerson('maya');
    budgetButton(sheet, 'Custom').click();
    await settle(fixture);
    typeInto(sheet.querySelector<HTMLInputElement>('#person-budget')!, '12,5');
    await settle(fixture);
    buttonByText(sheet, 'Save budget').click();
    await settle(fixture);
    expect(api.adminUpdateUser).toHaveBeenLastCalledWith('maya', {
      aiBudgetUnlimited: false,
      aiMonthlyBudgetUsd: 12.5,
    });
    expect(sheet.textContent).toContain('of $12.50 this month');

    budgetButton(sheet, 'Unlimited').click();
    await settle(fixture);
    buttonByText(sheet, 'Save budget').click();
    await settle(fixture);
    expect(api.adminUpdateUser).toHaveBeenLastCalledWith('maya', { aiBudgetUnlimited: true });
    expect(sheet.textContent).toContain('Unlimited · no monthly limit');
    expect(budgetButton(sheet, 'Unlimited').getAttribute('aria-checked')).toBe('true');
    expect(buttonByText(sheet, 'Save budget').disabled).toBe(true);

    budgetButton(sheet, 'Default').click();
    await settle(fixture);
    buttonByText(sheet, 'Save budget').click();
    await settle(fixture);
    expect(api.adminUpdateUser).toHaveBeenLastCalledWith('maya', {
      aiBudgetUnlimited: false,
      aiMonthlyBudgetUsd: null,
    });
    expect(sheet.textContent).toContain('of $5.00 this month');
  });

  it('shows the unlimited choice and the saved amount for a person with the flag set', async () => {
    api.adminUsers.mockResolvedValue([
      adminUser({
        id: 'maya',
        name: 'Maya',
        aiBudgetUnlimited: true,
        aiMonthlyBudgetUsd: 8,
        effectiveBudgetUsd: null,
        aiCostMonthUsd: 3,
      }),
    ]);
    const { fixture, sheet } = await openPerson('maya');
    expect(budgetButton(sheet, 'Unlimited').getAttribute('aria-checked')).toBe('true');
    expect(sheet.textContent).toContain('Unlimited · no monthly limit');
    expect(sheet.querySelector('[aria-label="AI budget used"]')).toBeNull();
    expect(buttonByText(sheet, 'Save budget').disabled).toBe(true);

    budgetButton(sheet, 'Custom').click();
    await settle(fixture);
    expect(sheet.querySelector<HTMLInputElement>('#person-budget')!.value).toBe('8');
    expect(buttonByText(sheet, 'Save budget').disabled).toBe(false);
    buttonByText(sheet, 'Save budget').click();
    await settle(fixture);
    expect(api.adminUpdateUser).toHaveBeenLastCalledWith('maya', {
      aiBudgetUnlimited: false,
      aiMonthlyBudgetUsd: 8,
    });
  });

  it('accepts a custom budget of exactly $10,000', async () => {
    const { fixture, sheet } = await openPerson('maya');
    budgetButton(sheet, 'Custom').click();
    await settle(fixture);
    typeInto(sheet.querySelector<HTMLInputElement>('#person-budget')!, '10000');
    await settle(fixture);
    buttonByText(sheet, 'Save budget').click();
    await settle(fixture);
    expect(api.adminUpdateUser).toHaveBeenLastCalledWith('maya', {
      aiBudgetUnlimited: false,
      aiMonthlyBudgetUsd: 10_000,
    });
    expect(sheet.textContent).toContain('of $10,000.00 this month');
  });

  it('rejects an invalid custom budget without calling the server', async () => {
    const { fixture, sheet } = await openPerson('maya');
    budgetButton(sheet, 'Custom').click();
    await settle(fixture);
    typeInto(sheet.querySelector<HTMLInputElement>('#person-budget')!, 'lots');
    await settle(fixture);
    buttonByText(sheet, 'Save budget').click();
    await settle(fixture);
    expect(api.adminUpdateUser).not.toHaveBeenCalled();
    expect(sheet.textContent).toContain(BUDGET_INVALID_MESSAGE);
    expect(BUDGET_INVALID_MESSAGE).toBe('Enter an amount from $0 to $10,000, or choose Unlimited.');
  });

  it('changes the role and access after confirming', async () => {
    const { fixture, sheet } = await openPerson('maya');
    buttonByText(sheet, 'Make admin Let them manage people and access').click();
    await settle(fixture);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Make admin' }));
    expect(api.adminUpdateUser).toHaveBeenLastCalledWith('maya', { role: 'admin' });

    buttonByText(sheet, 'Disable access Block sign-in and AI use, keep their data').click();
    await settle(fixture);
    expect(api.adminUpdateUser).toHaveBeenLastCalledWith('maya', { status: 'disabled' });
  });

  it('shows the server reason when a change is refused', async () => {
    api.adminUpdateUser.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 409,
        error: { statusCode: 409, message: 'There must always be at least one active admin' },
      }),
    );
    const { fixture, sheet } = await openPerson('maya');
    buttonByText(sheet, 'Make admin Let them manage people and access').click();
    await settle(fixture);
    expect(toasts()).toContain('There must always be at least one active admin.');
  });

  it('creates a password reset link and signs someone out everywhere', async () => {
    const { fixture, sheet } = await openPerson('maya');
    buttonByText(
      sheet,
      'Password reset link Create a link they can open to set a new password',
    ).click();
    await settle(fixture);
    expect(api.adminResetLink).toHaveBeenCalledWith('maya');
    expect(sheet.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(
      'https://food.example.com/reset/token-reset-maya',
    );

    buttonByText(sheet, 'Sign out everywhere Signed in on 1 device').click();
    await settle(fixture);
    expect(api.adminRevokeSessions).toHaveBeenCalledWith('maya');
  });

  it('deletes an account only after the email is typed', async () => {
    const { fixture, sheet } = await openPerson('maya');
    buttonByText(sheet, 'Delete account…').click();
    await settle(fixture);
    const deleteButton = buttonByText(sheet, 'Delete forever');
    expect(deleteButton.disabled).toBe(true);
    typeInto(sheet.querySelector<HTMLInputElement>('#person-delete-email')!, 'maya@example.co');
    await settle(fixture);
    expect(deleteButton.disabled).toBe(true);
    typeInto(sheet.querySelector<HTMLInputElement>('#person-delete-email')!, ' MAYA@example.com ');
    await settle(fixture);
    expect(deleteButton.disabled).toBe(false);
    deleteButton.click();
    await settle(fixture);
    expect(api.adminDeleteUser).toHaveBeenCalledWith('maya');
    expect(openDialog()).toBeNull();
  });

  it('protects your own row', async () => {
    const { sheet } = await openPerson('me');
    expect(sheet.textContent).toContain('This is you.');
    expect(sheet.textContent).not.toContain('Delete account');
    expect(sheet.textContent).not.toContain('Disable access');
    expect(sheet.textContent).not.toContain('Make member');
    expect(sheet.querySelector('[aria-label="Monthly AI budget"]')).not.toBeNull();
  });

  it('does not offer reset links for disabled people', async () => {
    api.adminUsers.mockResolvedValue([adminUser({ id: 'rana', status: 'disabled' })]);
    const { sheet } = await openPerson('rana');
    const reset = Array.from(sheet.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Password reset link'),
    )!;
    expect(reset.disabled).toBe(true);
    expect(reset.textContent).toContain('Enable their access first');
    expect(sheet.textContent).toContain('Enable access');
  });

  it('invites someone and shows the link', async () => {
    const { fixture, el } = await render('invites');
    buttonByText(el, 'Invite someone').click();
    await settle(fixture);
    const sheet = openDialog()!;
    typeInto(sheet.querySelector<HTMLInputElement>('#invite-email')!, ' sami@example.com ');
    typeInto(sheet.querySelector<HTMLInputElement>('#invite-name')!, ' Sami ');
    await settle(fixture);
    buttonByText(sheet, 'Create invite link').click();
    await settle(fixture);
    expect(api.adminCreateInvite).toHaveBeenCalledWith({
      email: 'sami@example.com',
      name: 'Sami',
      role: 'member',
    });
    expect(sheet.textContent).toContain('Invite ready');
    expect(sheet.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(
      'https://food.example.com/invite/token-created',
    );
  });

  it('regenerates and revokes pending invites', async () => {
    const { fixture, el } = await render('invites');
    const replacement = adminInvite({ id: 'nour-2', email: 'nour@example.com' });
    api.adminRegenerateInvite.mockResolvedValueOnce({
      invite: replacement,
      url: 'https://food.example.com/invite/token-nour-2',
    });
    api.adminInvites.mockResolvedValue([
      adminInvite({ id: 'nour', status: 'revoked' }),
      replacement,
    ]);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="New link for nour@example.com"]',
    )!.click();
    await settle(fixture);
    expect(api.adminRegenerateInvite).toHaveBeenCalledWith('nour');
    const sheet = openDialog()!;
    expect(sheet.textContent).toContain('The previous link no longer works.');
    expect(sheet.querySelector<HTMLInputElement>('input[readonly]')?.value).toContain(
      'token-nour-2',
    );
    expect(el.querySelector('details')?.textContent).toContain('Revoked');

    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Revoke link for nour@example.com"]',
    )!.click();
    await settle(fixture);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Revoke' }));
    expect(api.adminRevokeInvite).toHaveBeenCalledWith('nour-2');
  });

  it('shows an admins-only state when the server refuses', async () => {
    api.adminOverview.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
    const { el } = await render();
    expect(el.textContent).toContain('Admins only');
  });

  it('refreshes when the app comes back into view', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T10:00:00Z'));
    const { fixture } = await render();
    expect(api.adminOverview).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    await settle(fixture);
    expect(api.adminOverview).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T10:01:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    await settle(fixture);
    expect(api.adminOverview).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
