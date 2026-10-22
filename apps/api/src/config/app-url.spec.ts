import { appBaseUrl, appLink, originFromRequest } from './app-url.js';

describe('app URLs', () => {
  it('prefers the configured APP_URL', () => {
    expect(
      appBaseUrl(
        { appUrl: 'https://foodlog.example.com' },
        { protocol: 'http', host: 'internal:3000' },
      ),
    ).toBe('https://foodlog.example.com');
  });

  it('derives the origin from the request protocol and host', () => {
    expect(
      appBaseUrl(
        { appUrl: null },
        { protocol: 'https', host: 'FoodLog.example.com' },
      ),
    ).toBe('https://foodlog.example.com');
    expect(
      originFromRequest({ protocol: 'http', host: 'localhost:4200' }),
    ).toBe('http://localhost:4200');
    expect(originFromRequest({ protocol: 'https', host: '[::1]:3000' })).toBe(
      'https://[::1]:3000',
    );
  });

  it('refuses hosts that could smuggle a different link target', () => {
    expect(
      originFromRequest({ protocol: 'https', host: 'evil.com/path?x=' }),
    ).toBeNull();
    expect(
      originFromRequest({ protocol: 'https', host: 'user@evil.com' }),
    ).toBeNull();
    expect(
      originFromRequest({ protocol: 'https', host: undefined }),
    ).toBeNull();
    expect(
      appBaseUrl({ appUrl: null }, { protocol: 'http', host: 'a b' }),
    ).toBe('http://localhost');
  });

  it('joins links without doubled slashes', () => {
    expect(appLink('https://x.dev', '/invite/abc')).toBe(
      'https://x.dev/invite/abc',
    );
    expect(appLink('https://x.dev/app', 'reset/abc')).toBe(
      'https://x.dev/app/reset/abc',
    );
  });
});
