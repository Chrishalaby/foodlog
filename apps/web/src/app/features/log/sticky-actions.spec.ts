import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KeyboardService } from '../../core/keyboard.service';
import { NetworkService } from '../../core/network.service';
import { TOAST_CLEARANCE_ATTRIBUTE, TOAST_CLEARANCE_SELECTOR } from '../../core/toast-dock.service';
import { FLOATING_ACTIONS_CLASS, INLINE_ACTIONS_CLASS, StickyActions } from './sticky-actions';

@Component({
  imports: [StickyActions],
  template: `<app-sticky-actions><button type="button">Analyze</button></app-sticky-actions>`,
})
class Host {}

const classSet = (value: string): string[] => value.split(/\s+/).filter(Boolean).sort();

describe('StickyActions', () => {
  const keyboardOpen = signal(false);

  function render() {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: KeyboardService, useValue: { open: keyboardOpen.asReadonly() } },
        { provide: NetworkService, useValue: { online: signal(true).asReadonly() } },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const container = (): HTMLElement =>
      fixture.nativeElement.querySelector('[data-testid="sticky-actions"]');
    return { fixture, container };
  }

  beforeEach(() => keyboardOpen.set(false));

  it('floats above the navigation when no keyboard is open', () => {
    const { container } = render();
    expect(classSet(container().className)).toEqual(classSet(FLOATING_ACTIONS_CLASS));
    expect(container().style.bottom).toContain('4rem');
    expect(container().querySelector('button')?.textContent).toBe('Analyze');
  });

  it('marks its tray so toasts dock above it', () => {
    const { container } = render();
    expect(container().hasAttribute(TOAST_CLEARANCE_ATTRIBUTE)).toBe(true);
    expect(container().matches(TOAST_CLEARANCE_SELECTOR)).toBe(true);
  });

  it('flows inline under the content while the keyboard is open so typed text stays visible', () => {
    const { fixture, container } = render();
    keyboardOpen.set(true);
    fixture.detectChanges();
    expect(classSet(container().className)).toEqual(classSet(INLINE_ACTIONS_CLASS));
    expect(container().classList.contains('fixed')).toBe(false);
    expect(container().style.bottom).toBe('');
    expect(container().style.paddingBottom).toBe('');
  });
});
