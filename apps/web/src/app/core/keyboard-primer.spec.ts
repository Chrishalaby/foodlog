import { TestBed } from '@angular/core/testing';
import { KEYBOARD_PRIME_MS, KEYBOARD_PRIMER_ATTRIBUTE, KeyboardPrimer } from './keyboard-primer';

const SELECTOR = `[${KEYBOARD_PRIMER_ATTRIBUTE}]`;

describe('KeyboardPrimer', () => {
  let primer: KeyboardPrimer;

  beforeEach(() => {
    primer = TestBed.inject(KeyboardPrimer);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll(SELECTOR).forEach((element) => element.remove());
  });

  it('focuses a hidden text field right away so the keyboard can open', () => {
    primer.prime();
    const fields = document.querySelectorAll<HTMLInputElement>(SELECTOR);
    expect(fields.length).toBe(1);
    const field = fields[0];
    expect(document.activeElement).toBe(field);
    expect(field.type).toBe('text');
    expect(field.style.fontSize).toBe('16px');
    expect(field.tabIndex).toBe(-1);
    expect(field.getAttribute('aria-hidden')).toBe('true');
  });

  it('never creates a second field', () => {
    primer.prime();
    primer.prime();
    expect(document.querySelectorAll(SELECTOR).length).toBe(1);
    expect(document.activeElement).toBe(document.querySelector(SELECTOR));
  });

  it('removes itself as soon as the real field takes focus', () => {
    primer.prime();
    const real = document.createElement('input');
    document.body.appendChild(real);
    real.focus();
    expect(document.activeElement).toBe(real);
    expect(document.querySelector(SELECTOR)).toBeNull();
    real.remove();
  });

  it('lets the keyboard go when nothing claims focus in time', () => {
    vi.useFakeTimers();
    primer.prime();
    const field = document.querySelector(SELECTOR);
    vi.advanceTimersByTime(KEYBOARD_PRIME_MS - 1);
    expect(document.querySelector(SELECTOR)).toBe(field);
    vi.advanceTimersByTime(1);
    expect(document.querySelector(SELECTOR)).toBeNull();
    expect(document.activeElement).not.toBe(field);
  });

  it('holds the keyboard for a longer window when asked', () => {
    vi.useFakeTimers();
    primer.prime(8000);
    const field = document.querySelector(SELECTOR);
    vi.advanceTimersByTime(KEYBOARD_PRIME_MS + 1);
    expect(document.querySelector(SELECTOR)).toBe(field);
    vi.advanceTimersByTime(8000 - KEYBOARD_PRIME_MS - 1);
    expect(document.querySelector(SELECTOR)).toBeNull();
  });

  it('can prime again after the previous field is gone', () => {
    primer.prime();
    (document.activeElement as HTMLElement).blur();
    expect(document.querySelector(SELECTOR)).toBeNull();
    primer.prime();
    expect(document.activeElement).toBe(document.querySelector(SELECTOR));
  });
});
