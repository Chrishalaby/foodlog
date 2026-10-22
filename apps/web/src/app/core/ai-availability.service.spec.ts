import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AiConfigDto } from '@food/shared';
import { AiAvailability } from './ai-availability.service';
import { ProfileStore } from './profile.store';

describe('AiAvailability', () => {
  const ai = signal<Pick<AiConfigDto, 'provider' | 'voice'> | null>(null);

  beforeEach(() => {
    ai.set(null);
    TestBed.configureTestingModule({
      providers: [{ provide: ProfileStore, useValue: { ai } }],
    });
  });

  it('assumes AI is there until the server says otherwise', () => {
    const availability = TestBed.inject(AiAvailability);
    expect(availability.enabled()).toBe(true);
    expect(availability.voice()).toBe(true);
    ai.set({ provider: 'openai', voice: true });
    expect(availability.enabled()).toBe(true);
    ai.set({ provider: 'mock', voice: true });
    expect(availability.enabled()).toBe(true);
    ai.set({ provider: 'unconfigured', voice: false });
    expect(availability.enabled()).toBe(false);
    expect(availability.voice()).toBe(false);
  });

  it('turns voice off on its own when the server has no transcription', () => {
    const availability = TestBed.inject(AiAvailability);
    ai.set({ provider: 'openai', voice: false });
    expect(availability.enabled()).toBe(true);
    expect(availability.voice()).toBe(false);
  });
});
