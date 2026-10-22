import { TestBed } from '@angular/core/testing';
import type { WeightSummaryResponse } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { SessionScope } from '../../core/session-scope';
import { makeWeightSummary } from './today-fixtures';
import { WeightCardStore } from './weight-card-store';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe('WeightCardStore', () => {
  const weights = vi.fn<(from: string, to: string) => Promise<WeightSummaryResponse>>();
  let store: WeightCardStore;

  beforeEach(() => {
    weights.mockReset();
    weights.mockImplementation(async (from, to) =>
      makeWeightSummary(from, to, [{ date: to, weightKg: 81.2, bodyFatPct: null }]),
    );
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: { weights } }] });
    store = TestBed.inject(WeightCardStore);
  });

  it('forgets cached weigh-ins and ignores late answers when the session resets', async () => {
    await store.show('2026-09-27');
    await store.show('2026-09-28');
    expect(store.summary()?.latest?.weightKg).toBe(81.2);

    const late = deferred<WeightSummaryResponse>();
    weights.mockReturnValueOnce(late.promise);
    const refreshing = store.refresh();
    TestBed.inject(SessionScope).reset();
    late.resolve(makeWeightSummary('2026-08-30', '2026-09-28'));
    await refreshing;

    expect(store.date()).toBeNull();
    expect(store.summary()).toBeNull();
    expect(store.status()).toBe('loading');

    const next = deferred<WeightSummaryResponse>();
    weights.mockReturnValueOnce(next.promise);
    const showing = store.show('2026-09-27');
    expect(store.summary()).toBeNull();
    next.resolve(makeWeightSummary('2026-08-29', '2026-09-27'));
    await showing;
    expect(store.status()).toBe('ready');
    expect(store.summary()?.latest).toBeNull();
  });
});
