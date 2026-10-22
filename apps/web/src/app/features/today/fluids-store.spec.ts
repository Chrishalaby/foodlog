import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { CreateFluidLogRequest, FluidDayResponse, FluidLogDto } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { SessionScope } from '../../core/session-scope';
import { FluidsStore } from './fluids-store';
import { makeFluidDay, makeFluidDrink, makeFluidLog } from './today-fixtures';

const DAY = '2026-09-28';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function request(overrides: Partial<CreateFluidLogRequest> = {}): CreateFluidLogRequest {
  return {
    ml: 250,
    kind: 'water',
    timestamp: '2026-09-28T10:00:00.000Z',
    localDate: DAY,
    ...overrides,
  };
}

describe('FluidsStore', () => {
  let api: {
    fluidDay: ReturnType<typeof vi.fn<(date: string) => Promise<FluidDayResponse>>>;
    createFluid: ReturnType<typeof vi.fn<(body: CreateFluidLogRequest) => Promise<FluidLogDto>>>;
    deleteFluid: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  };
  let store: FluidsStore;

  beforeEach(() => {
    api = {
      fluidDay: vi.fn(async (date: string) => makeFluidDay(date)),
      createFluid: vi.fn(),
      deleteFluid: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    store = TestBed.inject(FluidsStore);
  });

  it('loads a day and serves it from the cache when coming back', async () => {
    api.fluidDay.mockResolvedValueOnce(makeFluidDay(DAY, [makeFluidLog({ id: 'a' })]));
    await store.show(DAY);
    expect(store.status()).toBe('ready');
    expect(store.day()?.totalMl).toBe(250);

    const pending = deferred<FluidDayResponse>();
    api.fluidDay.mockReturnValueOnce(pending.promise);
    void store.show('2026-09-27');
    expect(store.status()).toBe('loading');
    pending.resolve(makeFluidDay('2026-09-27'));
    await pending.promise;

    api.fluidDay.mockReturnValueOnce(new Promise(() => undefined));
    void store.show(DAY);
    expect(store.status()).toBe('ready');
    expect(store.day()?.logs.map((log) => log.id)).toEqual(['a']);
  });

  it('shows an error only when nothing is cached and recovers on retry', async () => {
    api.fluidDay.mockRejectedValueOnce(new Error('offline'));
    await store.show(DAY);
    expect(store.status()).toBe('error');
    await store.retry();
    expect(store.status()).toBe('ready');
  });

  it('adds optimistically, then swaps in the saved log and announces the change', async () => {
    await store.show(DAY);
    const events = TestBed.inject(DataEventsService);
    const saved = deferred<FluidLogDto>();
    api.createFluid.mockReturnValueOnce(saved.promise);

    const adding = store.add(request());
    expect(store.day()?.totalMl).toBe(250);
    expect(store.day()?.logs[0]?.id).toMatch(/^pending-/);
    expect(events.fluids()).toBe(0);

    saved.resolve(makeFluidLog({ id: 'f1', timestamp: '2026-09-28T10:00:00.000Z' }));
    await adding;
    expect(store.day()?.logs.map((log) => log.id)).toEqual(['f1']);
    expect(store.day()?.totalMl).toBe(250);
    expect(events.fluids()).toBe(1);
    expect(api.createFluid).toHaveBeenCalledWith(request());
  });

  it('rolls an add back when saving fails', async () => {
    await store.show(DAY);
    api.createFluid.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    await expect(store.add(request({ ml: 500 }))).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(store.day()?.logs).toEqual([]);
    expect(store.day()?.totalMl).toBe(0);
  });

  it('keeps a saved add when an older refresh lands afterwards', async () => {
    await store.show(DAY);
    const stale = deferred<FluidDayResponse>();
    api.fluidDay.mockReturnValueOnce(stale.promise);
    const refreshing = store.refresh();
    api.createFluid.mockResolvedValueOnce(makeFluidLog({ id: 'f1' }));
    await store.add(request());

    stale.resolve(makeFluidDay(DAY, [], [makeFluidDrink({ itemId: 'i1' })]));
    await refreshing;
    expect(store.day()?.logs.map((log) => log.id)).toEqual(['f1']);
    expect(store.day()?.foodMl).toBe(330);
    expect(store.day()?.totalMl).toBe(580);
  });

  it('removes optimistically and restores the log when deleting fails', async () => {
    api.fluidDay.mockResolvedValueOnce(makeFluidDay(DAY, [makeFluidLog({ id: 'a', ml: 500 })]));
    await store.show(DAY);
    const log = store.day()!.logs[0]!;
    const deleting = deferred<void>();
    api.deleteFluid.mockReturnValueOnce(deleting.promise);

    const removal = store.remove(log);
    expect(store.day()?.totalMl).toBe(0);
    deleting.reject(new HttpErrorResponse({ status: 500 }));
    await expect(removal).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(store.day()?.totalMl).toBe(500);
  });

  it('treats a log that is already gone as deleted', async () => {
    api.fluidDay.mockResolvedValueOnce(makeFluidDay(DAY, [makeFluidLog({ id: 'a' })]));
    await store.show(DAY);
    const events = TestBed.inject(DataEventsService);
    api.deleteFluid.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    await store.remove(store.day()!.logs[0]!);
    expect(store.day()?.logs).toEqual([]);
    expect(events.fluids()).toBe(1);
  });

  it('ignores deleting a log that is still being saved', async () => {
    await store.show(DAY);
    await store.remove(makeFluidLog({ id: 'pending-9' }));
    expect(api.deleteFluid).not.toHaveBeenCalled();
  });

  it('forgets another day when a log lands there', async () => {
    await store.show(DAY);
    await store.show('2026-09-27');
    api.createFluid.mockResolvedValueOnce(makeFluidLog({ id: 'f1' }));
    await store.add(request());
    const fetches = api.fluidDay.mock.calls.length;
    const showing = store.show(DAY);
    expect(store.status()).toBe('loading');
    await showing;
    expect(api.fluidDay.mock.calls.length).toBe(fetches + 1);
  });

  it('clears everything when the session resets', async () => {
    await store.show(DAY);
    TestBed.inject(SessionScope).reset();
    expect(store.date()).toBeNull();
    expect(store.day()).toBeNull();
    expect(store.status()).toBe('loading');
  });
});
