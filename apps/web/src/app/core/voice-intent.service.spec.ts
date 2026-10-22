import { TestBed } from '@angular/core/testing';
import { VOICE_INTENT_TTL_MS, VoiceIntentService } from './voice-intent.service';

describe('VoiceIntentService', () => {
  afterEach(() => vi.useRealTimers());

  it('hands a requested intent over exactly once', () => {
    const intent = TestBed.inject(VoiceIntentService);

    expect(intent.take()).toBe(false);
    intent.request();
    expect(intent.take()).toBe(true);
    expect(intent.take()).toBe(false);
  });

  it('forgets an intent nobody picked up in time', () => {
    vi.useFakeTimers();
    const intent = TestBed.inject(VoiceIntentService);

    intent.request();
    vi.advanceTimersByTime(VOICE_INTENT_TTL_MS + 1);

    expect(intent.take()).toBe(false);
  });
});
