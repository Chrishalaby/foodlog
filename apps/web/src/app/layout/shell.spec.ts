import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AdminPendingService } from '../core/admin-pending.service';
import { CaptureService } from '../core/capture.service';
import { KEYBOARD_PRIMER_ATTRIBUTE } from '../core/keyboard-primer';
import { KeyboardService } from '../core/keyboard.service';
import { NetworkService } from '../core/network.service';
import { TOAST_CLEARANCE_ATTRIBUTE } from '../core/toast-dock.service';
import { installDialogShim } from '../features/log/testing/dialog-shim';
import { COMPARE_PATH, LOG_WEIGHT_PATH, MEAL_IDEAS_PATH, Shell } from './shell';

const rowWith = (el: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button.action-row')).find((button) =>
    button.textContent?.includes(text),
  )!;

describe('Shell', () => {
  let restoreDialog: () => void;
  let keyboardOpen: ReturnType<typeof signal<boolean>>;
  let online: ReturnType<typeof signal<boolean>>;
  let pendingAccess: ReturnType<typeof signal<number>>;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    keyboardOpen = signal(false);
    online = signal(true);
    pendingAccess = signal(0);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: KeyboardService, useValue: { open: keyboardOpen } },
        { provide: NetworkService, useValue: { online } },
        { provide: AdminPendingService, useValue: { count: pendingAccess } },
      ],
    });
  });

  afterEach(() => {
    restoreDialog();
    document.querySelectorAll(`[${KEYBOARD_PRIMER_ATTRIBUTE}]`).forEach((field) => field.remove());
  });

  function isPrimer(element: Element | null): boolean {
    return element?.hasAttribute(KEYBOARD_PRIMER_ATTRIBUTE) === true;
  }

  function settingsLink(el: HTMLElement): HTMLAnchorElement {
    return Array.from(el.querySelectorAll<HTMLAnchorElement>('nav a')).find((link) =>
      link.textContent?.includes('Settings'),
    )!;
  }

  async function render() {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const capture = TestBed.inject(CaptureService);
    return { fixture, el, capture };
  }

  it('opens the camera straight from the FAB', async () => {
    const { el, capture } = await render();
    const camera = vi.spyOn(capture, 'requestCamera').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('button[aria-label="Take a food photo"]')!.click();
    expect(camera).toHaveBeenCalledWith('food_photo');
  });

  it('lists food search first in the log sheet and opens it', async () => {
    const { fixture, el, capture } = await render();
    const search = vi.spyOn(capture, 'openSearch').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('button[aria-label="More ways to log food"]')!.click();
    await fixture.whenStable();
    const rows = Array.from(el.querySelectorAll('button.action-row')).map((row) =>
      row.querySelector('.font-semibold')?.textContent?.trim(),
    );
    expect(rows[0]).toBe('Search my foods');
    expect(rows).toContain('Log weight');

    rowWith(el, 'Search my foods').click();
    await fixture.whenStable();
    expect(search).toHaveBeenCalledWith();
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('offers barcode scanning right after food search, then comparing options', async () => {
    const { fixture, el, capture } = await render();
    const scan = vi.spyOn(capture, 'requestBarcode').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('button[aria-label="More ways to log food"]')!.click();
    await fixture.whenStable();
    const rows = Array.from(el.querySelectorAll('button.action-row')).map((row) =>
      row.querySelector('.font-semibold')?.textContent?.trim(),
    );
    expect(rows.slice(0, 3)).toEqual(['Search my foods', 'Scan barcode', 'Compare options']);

    rowWith(el, 'Scan barcode').click();
    await fixture.whenStable();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('opens Compare from the log sheet', async () => {
    const { fixture, el } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>('button[aria-label="More ways to log food"]')!.click();
    await fixture.whenStable();
    rowWith(el, 'Compare options').click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(COMPARE_PATH);
    expect(COMPARE_PATH).toBe('/compare');
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('opens AI meal ideas on Today from the log sheet, right after comparing', async () => {
    const { fixture, el } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>('button[aria-label="More ways to log food"]')!.click();
    await fixture.whenStable();
    const rows = Array.from(el.querySelectorAll('button.action-row')).map((row) =>
      row.querySelector('.font-semibold')?.textContent?.trim(),
    );
    expect(rows[rows.indexOf('Compare options') + 1]).toBe('AI meal ideas');

    rowWith(el, 'AI meal ideas').click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(MEAL_IDEAS_PATH);
    expect(MEAL_IDEAS_PATH).toBe('/today?ideas=1');
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('opens the weight input on Today from the log sheet', async () => {
    const { fixture, el } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>('button[aria-label="More ways to log food"]')!.click();
    await fixture.whenStable();
    rowWith(el, 'Log weight').click();
    expect(navigate).toHaveBeenCalledWith(LOG_WEIGHT_PATH);
    expect(LOG_WEIGHT_PATH).toBe('/today?weight=1');
    expect(document.activeElement?.hasAttribute(KEYBOARD_PRIMER_ATTRIBUTE)).toBe(true);
  });

  it('hides the bottom nav and camera button while the on-screen keyboard is open', async () => {
    const { fixture, el } = await render();
    const nav = el.querySelector<HTMLElement>('nav[aria-label="Main"]')!;
    expect(nav.classList.contains('hidden')).toBe(false);

    keyboardOpen.set(true);
    await fixture.whenStable();
    expect(nav.classList.contains('hidden')).toBe(true);
    expect(nav.querySelector('button[aria-label="Take a food photo"]')).not.toBeNull();

    keyboardOpen.set(false);
    await fixture.whenStable();
    expect(nav.classList.contains('hidden')).toBe(false);
  });

  it('moves the offline notice down while the keyboard hides the nav', async () => {
    online.set(false);
    const { fixture, el } = await render();
    const notice = (): HTMLElement => el.querySelector<HTMLElement>('[role="status"]')!;
    expect(notice().classList.contains('bottom-3')).toBe(false);
    keyboardOpen.set(true);
    await fixture.whenStable();
    expect(notice().classList.contains('bottom-3')).toBe(true);
    expect(notice().classList.contains('fixed')).toBe(true);
  });

  it('raises the keyboard in the same tap that opens food search', async () => {
    const { fixture, el, capture } = await render();
    const search = vi.spyOn(capture, 'openSearch').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('button[aria-label="More ways to log food"]')!.click();
    await fixture.whenStable();
    rowWith(el, 'Search my foods').click();
    expect(isPrimer(document.activeElement)).toBe(true);
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('raises the keyboard in the same tap that starts describing food', async () => {
    const { fixture, el, capture } = await render();
    const text = vi.spyOn(capture, 'startText').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('button[aria-label="More ways to log food"]')!.click();
    await fixture.whenStable();
    rowWith(el, 'Describe food').click();
    expect(isPrimer(document.activeElement)).toBe(true);
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(text).toHaveBeenCalledTimes(1);
  });

  it('does not raise the keyboard for the camera', async () => {
    const { el, capture } = await render();
    vi.spyOn(capture, 'requestCamera').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('button[aria-label="Take a food photo"]')!.click();
    expect(isPrimer(document.activeElement)).toBe(false);
  });

  it('marks the settings tab while people are waiting for access', async () => {
    pendingAccess.set(1);
    const { fixture, el } = await render();
    const link = settingsLink(el);
    expect(link.querySelector('[data-testid="pending-access-dot"]')).not.toBeNull();
    expect(link.textContent).toContain('1 access request waiting');
    const others = Array.from(el.querySelectorAll('nav a')).filter((a) => a !== link);
    expect(others.some((a) => a.querySelector('[data-testid="pending-access-dot"]'))).toBe(false);

    pendingAccess.set(3);
    await fixture.whenStable();
    expect(link.textContent).toContain('3 access requests waiting');

    pendingAccess.set(0);
    await fixture.whenStable();
    expect(link.querySelector('[data-testid="pending-access-dot"]')).toBeNull();
    expect(link.textContent).not.toContain('waiting');
  });

  it('keeps toasts clear of the camera button and the offline notice', async () => {
    online.set(false);
    const { el } = await render();
    const docked = Array.from(el.querySelectorAll(`[${TOAST_CLEARANCE_ATTRIBUTE}]`));
    expect(docked.some((node) => node.querySelector('[aria-label="Take a food photo"]'))).toBe(
      true,
    );
    expect(docked.some((node) => node.getAttribute('role') === 'status')).toBe(true);
  });
});
