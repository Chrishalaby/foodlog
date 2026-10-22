import { demoBannerText } from './shell';

describe('demoBannerText', () => {
  const now = Date.parse('2026-10-22T12:00:00.000Z');

  it('says when the sandbox goes away and that AI is simulated', () => {
    expect(demoBannerText('2026-10-23T11:10:00.000Z', now)).toBe(
      'Demo sandbox · deleted in 24 hours · AI estimates are simulated',
    );
    expect(demoBannerText('2026-10-22T12:20:00.000Z', now)).toBe(
      'Demo sandbox · deleted in about an hour · AI estimates are simulated',
    );
    expect(demoBannerText('2026-10-22T11:00:00.000Z', now)).toContain('about an hour');
  });

  it('shows nothing outside the demo', () => {
    expect(demoBannerText(null, now)).toBeNull();
  });
});
