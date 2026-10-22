import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DataEventsService, type DataTopic } from '../../core/data-events.service';
import { DATA_REFRESH_DEBOUNCE_MS, watchData } from './data-watch';

@Component({ selector: 'app-watch-host', template: '' })
class WatchHost {
  readonly calls: DataTopic[][] = [];
  readonly watch = watchData(['entries', 'weights'], (changed) =>
    this.calls.push([...changed].sort()),
  );
}

describe('watchData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const fixture = TestBed.createComponent(WatchHost);
    TestBed.tick();
    return { fixture, host: fixture.componentInstance, events: TestBed.inject(DataEventsService) };
  }

  it('ignores the initial state and coalesces bursts of changes into one call', () => {
    const { host, events } = setup();
    expect(host.calls).toEqual([]);

    events.notify('entries');
    TestBed.tick();
    events.notify('weights', 'favorites');
    TestBed.tick();
    vi.advanceTimersByTime(DATA_REFRESH_DEBOUNCE_MS - 1);
    expect(host.calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(host.calls).toEqual([['entries', 'weights']]);
  });

  it('skips changes the host announced itself', () => {
    const { host, events } = setup();
    host.watch.notifyOthers('entries', 'profile');
    TestBed.tick();
    vi.advanceTimersByTime(DATA_REFRESH_DEBOUNCE_MS);
    expect(events.entries()).toBe(1);
    expect(events.profile()).toBe(1);
    expect(host.calls).toEqual([]);

    events.notify('entries');
    TestBed.tick();
    vi.advanceTimersByTime(DATA_REFRESH_DEBOUNCE_MS);
    expect(host.calls).toEqual([['entries']]);
  });

  it('can run pending work early or drop it', () => {
    const { host, events } = setup();
    events.notify('entries');
    TestBed.tick();
    host.watch.flush();
    expect(host.calls).toEqual([['entries']]);

    events.notify('weights');
    TestBed.tick();
    host.watch.cancel();
    vi.advanceTimersByTime(DATA_REFRESH_DEBOUNCE_MS * 2);
    expect(host.calls).toEqual([['entries']]);
  });

  it('stops listening when the host is destroyed', () => {
    const { fixture, host, events } = setup();
    events.notify('entries');
    TestBed.tick();
    fixture.destroy();
    vi.advanceTimersByTime(DATA_REFRESH_DEBOUNCE_MS * 2);
    expect(host.calls).toEqual([]);
  });
});
