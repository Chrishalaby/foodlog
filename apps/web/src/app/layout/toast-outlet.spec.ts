import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { KeyboardService } from '../core/keyboard.service';
import { TOAST_CLEARANCE_ATTRIBUTE } from '../core/toast-dock.service';
import { ToastService } from '../core/toast.service';
import { ToastOutlet } from './toast-outlet';

describe('ToastOutlet placement', () => {
  let fixture: ComponentFixture<ToastOutlet>;
  let host: HTMLElement;
  let toasts: ToastService;
  let keyboardOpen: ReturnType<typeof signal<boolean>>;
  const bars: HTMLElement[] = [];

  beforeEach(async () => {
    keyboardOpen = signal(false);
    TestBed.configureTestingModule({
      providers: [{ provide: KeyboardService, useValue: { open: keyboardOpen } }],
    });
    fixture = TestBed.createComponent(ToastOutlet);
    host = fixture.nativeElement as HTMLElement;
    toasts = TestBed.inject(ToastService);
    await fixture.whenStable();
  });

  afterEach(() => {
    toasts.clear();
    bars.splice(0).forEach((bar) => bar.remove());
  });

  function addBar(height: number): HTMLElement {
    const bar = document.createElement('div');
    bar.setAttribute(TOAST_CLEARANCE_ATTRIBUTE, '');
    bar.getBoundingClientRect = () =>
      ({ top: window.innerHeight - height, height, width: 390 }) as DOMRect;
    document.body.appendChild(bar);
    bars.push(bar);
    return bar;
  }

  function stack(): HTMLElement {
    return host.querySelector<HTMLElement>('app-toast-stack')!;
  }

  it('stays at the top where nothing is docked at the bottom', async () => {
    toasts.success('Signed in');
    await fixture.whenStable();
    expect(host.dataset['placement']).toBe('top');
    expect(host.style.top).toContain('safe-area-inset-top');
    expect(host.style.bottom).toBe('');
    expect(stack().style.flexDirection).toBe('');
  });

  it('sits just above the camera button so undo is in thumb reach', async () => {
    addBar(100);
    toasts.success('Logged yogurt', { action: { label: 'Undo', run: vi.fn() } });
    await fixture.whenStable();
    expect(host.dataset['placement']).toBe('bottom');
    expect(host.style.bottom).toBe('112px');
    expect(host.style.top).toBe('');
    expect(stack().style.flexDirection).toBe('column-reverse');
    expect(host.style.getPropertyValue('--toast-enter-offset')).toBe('12px');
  });

  it('keeps the newest toast nearest the thumb', async () => {
    addBar(100);
    toasts.success('First');
    toasts.success('Second');
    await fixture.whenStable();
    const messages = Array.from(host.querySelectorAll('[role="group"]')).map((group) =>
      group.textContent?.trim(),
    );
    expect(messages[0]).toContain('First');
    expect(messages[1]).toContain('Second');
    expect(stack().style.flexDirection).toBe('column-reverse');
  });

  it('moves back to the top while the keyboard is open', async () => {
    addBar(100);
    toasts.success('Logged yogurt');
    await fixture.whenStable();
    keyboardOpen.set(true);
    await fixture.whenStable();
    expect(host.dataset['placement']).toBe('top');
    expect(host.style.top).toContain('safe-area-inset-top');
    expect(host.style.bottom).toBe('');
  });

  it('follows the bars as they appear and go', async () => {
    toasts.success('Saved');
    await fixture.whenStable();
    expect(host.dataset['placement']).toBe('top');
    const bar = addBar(140);
    toasts.success('Saved again');
    await fixture.whenStable();
    expect(host.style.bottom).toBe('152px');
    bar.remove();
    toasts.info('Later');
    await fixture.whenStable();
    expect(host.dataset['placement']).toBe('top');
  });
});
