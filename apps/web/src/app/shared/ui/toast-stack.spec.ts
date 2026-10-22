import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ToastService } from '../../core/toast.service';
import { ToastOutlet } from '../../layout/toast-outlet';
import { SheetStack } from './sheet-stack';

describe('ToastOutlet and ToastStack', () => {
  let fixture: ComponentFixture<ToastOutlet>;
  let el: HTMLElement;
  let toasts: ToastService;

  const buttons = (root: ParentNode): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
  const buttonByText = (root: ParentNode, text: string): HTMLButtonElement =>
    buttons(root).find((button) => button.textContent?.trim() === text)!;
  const groups = (): HTMLElement[] =>
    Array.from(el.querySelectorAll<HTMLElement>('[role="group"]'));

  beforeEach(async () => {
    fixture = TestBed.createComponent(ToastOutlet);
    el = fixture.nativeElement as HTMLElement;
    toasts = TestBed.inject(ToastService);
    await fixture.whenStable();
  });

  afterEach(() => toasts.clear());

  it('is a labelled region with persistent polite and assertive live regions', async () => {
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('Notifications');
    const status = el.querySelector('[role="status"]')!;
    const alert = el.querySelector('[role="alert"]')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(alert.getAttribute('aria-live')).toBe('assertive');

    toasts.success('Saved');
    await fixture.whenStable();
    expect(status.textContent?.trim()).toBe('Saved');
    expect(alert.textContent?.trim()).toBe('');

    toasts.error('Could not save');
    await fixture.whenStable();
    expect(alert.textContent?.trim()).toBe('Could not save');
    expect(status.textContent?.trim()).toBe('');
  });

  it('changes the announcement text when the same message is shown again', async () => {
    toasts.success('Saved');
    await fixture.whenStable();
    const status = el.querySelector('[role="status"]')!;
    const first = status.textContent;
    toasts.success('Saved');
    await fixture.whenStable();
    expect(status.textContent).not.toBe(first);
    expect(status.textContent?.trim()).toBe('Saved');
  });

  it('labels each toast by its message and keeps buttons at least 44 px', async () => {
    toasts.info('Update ready', { action: { label: 'Reload', run: vi.fn() } });
    await fixture.whenStable();
    const [group] = groups();
    const messageId = group!.getAttribute('aria-labelledby')!;
    expect(el.querySelector(`#${messageId}`)?.textContent?.trim()).toBe('Update ready');
    const reload = buttonByText(group!, 'Reload');
    expect(reload.className).toContain('min-h-11');
    const dismiss = group!.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss notification"]',
    )!;
    expect(dismiss.className).toContain('btn-icon');
    dismiss.click();
    await fixture.whenStable();
    expect(groups()).toHaveLength(0);
  });

  it('renders every action and runs the chosen one', async () => {
    const undo = vi.fn();
    const view = vi.fn();
    toasts.success('Logged Khoury strawberry yogurt', {
      actions: [
        { label: 'Undo', run: undo },
        { label: 'View', run: view },
      ],
    });
    await fixture.whenStable();
    const [group] = groups();
    expect(buttons(group!).map((b) => b.textContent?.trim())).toEqual(['', 'Undo', 'View']);
    buttonByText(group!, 'View').click();
    await fixture.whenStable();
    expect(view).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
    expect(groups()).toHaveLength(0);
  });

  it('pauses auto-dismiss on hover and focus and resumes afterwards', async () => {
    const id = toasts.success('Saved');
    await fixture.whenStable();
    const [group] = groups();
    group!.dispatchEvent(new Event('pointerenter'));
    expect(toasts.isPaused(id)).toBe(true);
    group!.dispatchEvent(new Event('pointerleave'));
    expect(toasts.isPaused(id)).toBe(false);

    const dismiss = group!.querySelector('button')!;
    dismiss.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(toasts.isPaused(id)).toBe(true);
    dismiss.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: group }));
    expect(toasts.isPaused(id)).toBe(true);
    dismiss.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(toasts.isPaused(id)).toBe(false);
  });

  it('dismisses the focused toast with Escape', async () => {
    toasts.success('Saved');
    await fixture.whenStable();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    groups()[0]!.dispatchEvent(event);
    await fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
    expect(toasts.toasts()).toHaveLength(0);
  });

  it('hands the stack to the topmost sheet while one is open', async () => {
    toasts.success('Saved');
    await fixture.whenStable();
    const sheets = TestBed.inject(SheetStack);
    const owner = {};
    sheets.push(owner);
    await fixture.whenStable();
    expect(el.querySelector('app-toast-stack')).toBeNull();
    const later = Date.now() + 5000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    sheets.remove(owner);
    await fixture.whenStable();
    clock.mockRestore();
    expect(groups()).toHaveLength(1);
    expect(groups()[0]!.classList.contains('animate-toast-in')).toBe(false);
  });

  it('animates only toasts that appear while the stack is mounted', async () => {
    toasts.success('New');
    await fixture.whenStable();
    expect(groups()[0]!.classList.contains('animate-toast-in')).toBe(true);
  });

  it('keeps the page live region mounted but silent while a sheet hosts the toasts', async () => {
    const status = el.querySelector('[role="status"]')!;
    const sheets = TestBed.inject(SheetStack);
    const owner = {};
    sheets.push(owner);
    await fixture.whenStable();
    const id = toasts.success('Logged while closing');
    await fixture.whenStable();
    expect(status.textContent?.trim()).toBe('');

    sheets.remove(owner);
    await fixture.whenStable();
    expect(el.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent?.trim()).toBe('Logged while closing');

    toasts.dismiss(id);
    await fixture.whenStable();
    expect(status.textContent?.trim()).toBe('');
  });

  it('does not announce a toast twice when another region already claimed it', async () => {
    const id = toasts.info('Already announced');
    expect(toasts.claimAnnouncement(id)).toBe(true);
    await fixture.whenStable();
    expect(el.querySelector('[role="status"]')!.textContent?.trim()).toBe('');
    expect(groups()).toHaveLength(1);
  });
});
