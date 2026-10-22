import { TestBed } from '@angular/core/testing';
import { DataEventsService } from './data-events.service';

describe('DataEventsService', () => {
  it('bumps only the notified topics', () => {
    const events = TestBed.inject(DataEventsService);
    events.notify('entries', 'favorites');
    events.notify('entries');
    expect(events.entries()).toBe(2);
    expect(events.favorites()).toBe(1);
    expect(events.weights()).toBe(0);
    expect(events.fluids()).toBe(0);
  });

  it('tracks fluid changes as their own topic', () => {
    const events = TestBed.inject(DataEventsService);
    events.notify('fluids');
    expect(events.fluids()).toBe(1);
    expect(events.entries()).toBe(0);
  });
});
