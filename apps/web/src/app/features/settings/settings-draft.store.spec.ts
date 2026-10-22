import { TestBed } from '@angular/core/testing';
import type { ProfileDto } from '@food/shared';
import { SessionScope } from '../../core/session-scope';
import { DEFAULT_PROFILE, toFormModel } from './profile-model';
import { type SettingsDraft, SettingsDraftStore } from './settings-draft.store';

const SERVER: ProfileDto = { ...DEFAULT_PROFILE, weightKg: 80, heightCm: 175, age: 30 };

function draft(userId: string): SettingsDraft {
  return {
    userId,
    serverProfile: SERVER,
    baseline: SERVER,
    model: toFormModel({ ...SERVER, weightKg: 90 }),
  };
}

describe('SettingsDraftStore', () => {
  it('restores a kept draft once, and only for the same user', () => {
    const store = TestBed.inject(SettingsDraftStore);
    store.keep(draft('u1'));
    expect(store.restore('u2', SERVER)).toBeNull();
    store.keep(draft('u1'));
    const kept = store.restore('u1', SERVER);
    expect(kept?.model.weightKg).toBe(90);
    expect(kept?.baseline).toBe(SERVER);
    expect(store.restore('u1', SERVER)).toBeNull();
  });

  it('keeps unsaved edits on top of a profile that changed elsewhere', () => {
    const store = TestBed.inject(SettingsDraftStore);
    store.keep({ ...draft('u1'), model: toFormModel({ ...SERVER, heightCm: 181 }) });
    const changed: ProfileDto = { ...SERVER, weightKg: 78.5, age: 31 };
    const kept = store.restore('u1', changed);
    expect(kept?.model.heightCm).toBe(181);
    expect(kept?.model.weightKg).toBe(78.5);
    expect(kept?.model.age).toBe(31);
    expect(kept?.baseline).toEqual(changed);
    expect(kept?.serverProfile).toBe(changed);
  });

  it('lets the unsaved value win when the same field changed on both sides', () => {
    const store = TestBed.inject(SettingsDraftStore);
    store.keep(draft('u1'));
    const kept = store.restore('u1', { ...SERVER, weightKg: 78.5, age: 31 });
    expect(kept?.model.weightKg).toBe(90);
    expect(kept?.model.age).toBe(31);
  });

  it('keeps the theme the draft started from as its baseline', () => {
    const store = TestBed.inject(SettingsDraftStore);
    const baseline: ProfileDto = { ...SERVER, theme: 'light' };
    store.keep({
      userId: 'u1',
      serverProfile: SERVER,
      baseline,
      model: toFormModel({ ...baseline, theme: 'system', heightCm: 181 }),
    });
    const kept = store.restore('u1', { ...SERVER, weightKg: 78.5 });
    expect(kept?.baseline.theme).toBe('light');
    expect(kept?.model.theme).toBe('system');
  });

  it('forgets the draft when the session resets', () => {
    const store = TestBed.inject(SettingsDraftStore);
    store.keep(draft('u1'));
    TestBed.inject(SessionScope).reset();
    expect(store.restore('u1', SERVER)).toBeNull();
  });
});
