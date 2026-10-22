import { buildConfig } from '../../test/support/config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  generateSetupCode,
  normalizeSetupCode,
  setupCodesMatch,
} from './setup-code.js';
import { SetupCodeService } from './setup-code.service.js';

function prismaWithUsers(count: number): PrismaService {
  return {
    user: { count: () => Promise.resolve(count) },
  } as unknown as PrismaService;
}

describe('setup codes', () => {
  it('generates human-friendly grouped codes without ambiguous characters', () => {
    const code = generateSetupCode();
    expect(code).toMatch(
      /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
    );
    expect(generateSetupCode()).not.toBe(code);
  });

  it('compares codes ignoring case, spaces and dashes', () => {
    expect(normalizeSetupCode(' abcd-efgh jkmn ')).toBe('ABCDEFGHJKMN');
    expect(setupCodesMatch('abcd efgh-jkmn', 'ABCD-EFGH-JKMN')).toBe(true);
    expect(setupCodesMatch('ABCD-EFGH-JKMP', 'ABCD-EFGH-JKMN')).toBe(false);
    expect(setupCodesMatch('', '')).toBe(false);
  });
});

describe('SetupCodeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses SETUP_CODE when configured and logs nothing', async () => {
    const service = new SetupCodeService(
      buildConfig({ SETUP_CODE: 'my-code' }),
      prismaWithUsers(0),
    );
    const warn = vi.spyOn(service['logger'], 'warn');

    await service.onApplicationBootstrap();

    expect(service.matches('MY-CODE')).toBe(true);
    expect(service.matches('other')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('generates and logs a code at boot when no account exists', async () => {
    const service = new SetupCodeService(buildConfig(), prismaWithUsers(0));
    const warn = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    await service.onApplicationBootstrap();

    expect(warn).toHaveBeenCalledOnce();
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('No account yet');
    const code = /setup code: ([A-Z0-9-]+)/.exec(message)?.[1] ?? '';
    expect(service.matches(code)).toBe(true);
  });

  it('does not generate a code at boot when an account exists', async () => {
    const service = new SetupCodeService(buildConfig(), prismaWithUsers(1));
    const warn = vi.spyOn(service['logger'], 'warn');

    await service.onApplicationBootstrap();

    expect(warn).not.toHaveBeenCalled();
  });
});
