import { Component, ErrorHandler, Injectable, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionScope, onSessionReset } from './session-scope';

@Injectable({ providedIn: 'root' })
class CachingStore {
  value: string | null = 'cached';

  constructor() {
    onSessionReset(() => {
      this.value = null;
    });
  }
}

@Component({ template: '' })
class Widget {
  resets = 0;

  constructor() {
    onSessionReset(() => this.resets++);
  }
}

describe('SessionScope', () => {
  it('runs every handler and bumps the epoch on reset', () => {
    const scope = TestBed.inject(SessionScope);
    const store = TestBed.inject(CachingStore);
    const other = vi.fn();
    scope.onReset(other);
    expect(scope.epoch()).toBe(0);

    scope.reset();

    expect(scope.epoch()).toBe(1);
    expect(store.value).toBeNull();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('stops calling a handler once it is removed or its owner is destroyed', () => {
    const scope = TestBed.inject(SessionScope);
    const handler = vi.fn();
    const remove = scope.onReset(handler);
    const fixture = TestBed.createComponent(Widget);
    const widget = fixture.componentInstance;

    scope.reset();
    remove();
    fixture.destroy();
    scope.reset();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(widget.resets).toBe(1);
  });

  it('keeps resetting the other stores when one handler throws', () => {
    const handleError = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: ErrorHandler, useValue: { handleError } }],
    });
    const scope = TestBed.inject(SessionScope);
    const failure = new Error('broken store');
    const after = vi.fn();
    scope.onReset(() => {
      throw failure;
    });
    scope.onReset(after);

    scope.reset();

    expect(handleError).toHaveBeenCalledWith(failure);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('allows the same function to be registered by two owners', () => {
    const scope = TestBed.inject(SessionScope);
    const shared = vi.fn();
    const removeFirst = scope.onReset(shared);
    scope.onReset(shared);
    removeFirst();

    scope.reset();

    expect(shared).toHaveBeenCalledTimes(1);
  });

  it('is available to root services created later', () => {
    const scope = TestBed.inject(SessionScope);
    scope.reset();
    const store = TestBed.runInInjectionContext(() => inject(CachingStore));
    expect(store.value).toBe('cached');
    scope.reset();
    expect(store.value).toBeNull();
  });
});
