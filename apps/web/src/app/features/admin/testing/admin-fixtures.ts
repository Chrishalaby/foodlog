import type {
  AdminAccessRequestDto,
  AdminInviteDto,
  AdminOverviewResponse,
  AdminUserDto,
  InviteLinkResponse,
  UpdateAdminUserRequest,
} from '@food/shared';
import { effectiveBudgetOf } from '../admin-format';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const isoFromNow = (offsetMs: number, now: number = Date.now()): string =>
  new Date(now + offsetMs).toISOString();

export function adminUser(
  overrides: Partial<AdminUserDto> & Pick<AdminUserDto, 'id'>,
): AdminUserDto {
  return {
    email: `${overrides.id}@example.com`,
    name: null,
    role: 'member',
    status: 'active',
    createdAt: isoFromNow(-30 * DAY_MS),
    lastSeenAt: isoFromNow(-HOUR_MS),
    entryCount: 0,
    aiRequestsMonth: 0,
    aiCostMonthUsd: 0,
    aiMonthlyBudgetUsd: null,
    aiBudgetUnlimited: false,
    effectiveBudgetUsd: 5,
    activeSessions: 1,
    isSelf: false,
    ...overrides,
  };
}

export function accessRequest(
  overrides: Partial<AdminAccessRequestDto> & Pick<AdminAccessRequestDto, 'id'>,
): AdminAccessRequestDto {
  return {
    email: `${overrides.id}@example.com`,
    name: overrides.id,
    message: null,
    status: 'pending',
    createdAt: isoFromNow(-HOUR_MS),
    decidedAt: null,
    decidedByEmail: null,
    acceptedAt: null,
    hasAccount: false,
    ...overrides,
  };
}

export function adminInvite(
  overrides: Partial<AdminInviteDto> & Pick<AdminInviteDto, 'id'>,
): AdminInviteDto {
  return {
    type: 'invite',
    email: `${overrides.id}@example.com`,
    name: null,
    role: 'member',
    status: 'pending',
    createdAt: isoFromNow(-HOUR_MS),
    expiresAt: isoFromNow(5 * DAY_MS),
    usedAt: null,
    createdByEmail: null,
    ...overrides,
  };
}

export function inviteLink(invite: AdminInviteDto): InviteLinkResponse {
  const path = invite.type === 'reset' ? 'reset' : 'invite';
  return { invite, url: `https://food.example.com/${path}/token-${invite.id}` };
}

export function adminOverview(
  overrides: Partial<AdminOverviewResponse> = {},
): AdminOverviewResponse {
  return {
    users: 3,
    activeUsers30d: 2,
    pendingRequests: 1,
    pendingInvites: 1,
    aiCostMonthUsd: 6.5,
    aiRequestsMonth: 120,
    globalBudgetUsd: 50,
    memberDefaultBudgetUsd: 5,
    ...overrides,
  };
}

export function installDialogShim(): () => void {
  const proto = HTMLDialogElement.prototype;
  const keys = ['open', 'showModal', 'close'] as const;
  const originals = keys.map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
  Object.defineProperty(proto, 'open', {
    configurable: true,
    get(this: HTMLDialogElement) {
      return this.hasAttribute('open');
    },
  });
  Object.defineProperty(proto, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(proto, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (this.hasAttribute('open')) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      }
    },
  });
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(proto, key, descriptor);
      } else {
        Reflect.deleteProperty(proto, key);
      }
    }
  };
}

export function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.replace(/\s+/g, ' ').trim() === text,
  );
  if (!match) {
    throw new Error(`No button "${text}"`);
  }
  return match;
}

export function adminApiImpl() {
  let users: AdminUserDto[] = [
    adminUser({ id: 'me', isSelf: true, role: 'admin', effectiveBudgetUsd: null }),
    adminUser({ id: 'maya', name: 'Maya' }),
  ];
  return {
    adminOverview: async (): Promise<AdminOverviewResponse> => adminOverview(),
    adminUsers: async (): Promise<AdminUserDto[]> => users,
    adminAccessRequests: async (): Promise<AdminAccessRequestDto[]> => [
      accessRequest({ id: 'lina', name: 'Lina' }),
    ],
    adminInvites: async (): Promise<AdminInviteDto[]> => [adminInvite({ id: 'nour' })],
    adminApproveRequest: async (id: string): Promise<InviteLinkResponse> =>
      inviteLink(adminInvite({ id: `inv-${id}`, email: `${id}@example.com` })),
    adminRejectRequest: async (id: string): Promise<AdminAccessRequestDto> =>
      accessRequest({ id, name: 'Lina', status: 'rejected', decidedAt: new Date().toISOString() }),
    adminUpdateUser: async (id: string, body: UpdateAdminUserRequest): Promise<AdminUserDto> => {
      const current = users.find((user) => user.id === id) ?? adminUser({ id, name: 'Maya' });
      const merged: AdminUserDto = { ...current, ...(body as Partial<AdminUserDto>) };
      const updated = { ...merged, effectiveBudgetUsd: effectiveBudgetOf(merged, 5) };
      users = users.map((user) => (user.id === id ? updated : user));
      return updated;
    },
    adminResetLink: async (id: string): Promise<InviteLinkResponse> =>
      inviteLink(adminInvite({ id: `reset-${id}`, type: 'reset' })),
    adminRevokeSessions: async (_id: string): Promise<void> => undefined,
    adminDeleteUser: async (_id: string): Promise<void> => undefined,
    adminCreateInvite: async (body: { email: string }): Promise<InviteLinkResponse> =>
      inviteLink(adminInvite({ id: 'created', email: body.email })),
    adminRegenerateInvite: async (id: string): Promise<InviteLinkResponse> =>
      inviteLink(adminInvite({ id: `${id}-2` })),
    adminRevokeInvite: async (_id: string): Promise<void> => undefined,
  };
}
