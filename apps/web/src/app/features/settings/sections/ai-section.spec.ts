import {
  MEMBER_UNCONFIGURED_TEXT,
  PROVIDER_BANNERS,
  aiBudgetView,
  providerBanner,
} from './ai-section';

const MID_MONTH = new Date('2026-09-15T12:00:00.000Z');

describe('aiBudgetView', () => {
  it('shows the budget with a meter once this month’s usage is known', () => {
    const view = aiBudgetView(10, 2, MID_MONTH);
    expect(view.amount).toBe('$10.00');
    expect(view.used).toBe('$2.00');
    expect(view.percent).toBe(20);
    expect(view.fillPercent).toBe(20);
    expect(view.barClass).toBe('bg-brand');
    expect(view.note).toBe('20% used · $8.00 left');
    expect(view.noteClass).toBe('text-muted');
  });

  it('shows just the budget while usage is loading or unavailable', () => {
    const view = aiBudgetView(5, null, MID_MONTH);
    expect(view.amount).toBe('$5.00');
    expect(view.used).toBeNull();
    expect(view.fillPercent).toBeNull();
    expect(view.note).toContain('pause');
  });

  it('warns when the current pace will use up the budget before the month ends', () => {
    const view = aiBudgetView(10, 6, MID_MONTH);
    expect(view.barClass).toBe('bg-brand');
    expect(view.noteClass).toBe('text-warn');
    expect(view.note).toContain('before the month ends');
  });

  it('says when the budget is used up', () => {
    const view = aiBudgetView(5, 5.2, MID_MONTH);
    expect(view.fillPercent).toBe(100);
    expect(view.barClass).toBe('bg-danger');
    expect(view.noteClass).toBe('text-danger');
    expect(view.note).toContain('blocked until next month');
  });

  it('explains a zero budget instead of drawing an empty meter', () => {
    const view = aiBudgetView(0, 0, MID_MONTH);
    expect(view.amount).toBe('$0.00');
    expect(view.fillPercent).toBeNull();
    expect(view.noteClass).toBe('text-warn');
    expect(view.note).toContain('paused');
  });

  it('reports usage without a meter when there is no limit', () => {
    expect(aiBudgetView(null, 1.5, MID_MONTH)).toMatchObject({
      amount: 'No limit',
      fillPercent: null,
      note: '$1.50 used this month.',
    });
    expect(aiBudgetView(null, null, MID_MONTH).note).toBe('Your account has no monthly AI limit.');
  });
});

describe('providerBanner', () => {
  it('tells an admin which server setting turns AI on', () => {
    expect(providerBanner('unconfigured', true).text).toContain('OPENAI_API_KEY');
  });

  it('never names server settings to a member and points to other ways to log', () => {
    const banner = providerBanner('unconfigured', false);
    expect(banner.text).toBe(MEMBER_UNCONFIGURED_TEXT);
    expect(banner.text).not.toContain('OPENAI_API_KEY');
    expect(banner.title).toBe(PROVIDER_BANNERS.unconfigured.title);
  });

  it('shows the same connected and demo banners to everyone', () => {
    for (const provider of ['openai', 'mock'] as const) {
      expect(providerBanner(provider, false)).toEqual(PROVIDER_BANNERS[provider]);
      expect(providerBanner(provider, true)).toEqual(PROVIDER_BANNERS[provider]);
    }
  });
});
