import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UnsavedWorkService, registerUnsavedWork } from './unsaved-work.service';

const dirty = signal(false);

@Component({ template: '' })
class Editor {
  constructor() {
    registerUnsavedWork(() => dirty());
  }
}

describe('UnsavedWorkService', () => {
  beforeEach(() => dirty.set(false));

  it('reports unsaved work while a registered screen has some', () => {
    const service = TestBed.inject(UnsavedWorkService);
    const fixture = TestBed.createComponent(Editor);
    expect(service.hasUnsavedWork()).toBe(false);
    dirty.set(true);
    expect(service.hasUnsavedWork()).toBe(true);
    fixture.destroy();
    expect(service.hasUnsavedWork()).toBe(false);
  });

  it('checks every registered screen', () => {
    const service = TestBed.inject(UnsavedWorkService);
    TestBed.createComponent(Editor);
    const other = signal(false);
    const remove = TestBed.runInInjectionContext(() => registerUnsavedWork(() => other()));
    other.set(true);
    expect(service.hasUnsavedWork()).toBe(true);
    remove();
    expect(service.hasUnsavedWork()).toBe(false);
  });
});
