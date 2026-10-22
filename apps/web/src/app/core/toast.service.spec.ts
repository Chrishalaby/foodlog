import { TestBed } from '@angular/core/testing';
import {
  TOAST_ACTION_DURATION_MS,
  TOAST_DEFAULT_DURATION_MS,
  TOAST_MAX_DURATION_MS,
  TOAST_MAX_VISIBLE,
  TOAST_RESUME_MIN_MS,
  ToastService,
  toastDurationMs,
} from './toast.service';
import { SessionScope } from './session-scope';

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = TestBed.inject(ToastService);
  });

  afterEach(() => {
    service.clear();
    Reflect.deleteProperty(document, 'visibilityState');
    vi.useRealTimers();
  });

  it('uses kind defaults, stretches long messages and gives actions more time', () => {
    expect(toastDurationMs('success', 'Saved', 0)).toBe(TOAST_DEFAULT_DURATION_MS.success);
    expect(toastDurationMs('error', 'Oops', 0)).toBe(TOAST_DEFAULT_DURATION_MS.error);
    expect(toastDurationMs('info', 'Logged', 2)).toBe(TOAST_ACTION_DURATION_MS);
    expect(toastDurationMs('success', 'x'.repeat(100), 0)).toBeGreaterThan(
      TOAST_DEFAULT_DURATION_MS.success,
    );
    expect(toastDurationMs('error', 'x'.repeat(5000), 0)).toBe(TOAST_MAX_DURATION_MS);
  });

  it('auto-dismisses after the resolved duration and keeps sticky toasts', () => {
    const id = service.success('Saved');
    const sticky = service.info('Update ready', { durationMs: 0 });
    expect(service.toasts().find((t) => t.id === id)?.durationMs).toBe(4000);
    vi.advanceTimersByTime(3999);
    expect(service.toasts().map((t) => t.id)).toEqual([id, sticky]);
    vi.advanceTimersByTime(1);
    expect(service.toasts().map((t) => t.id)).toEqual([sticky]);
    vi.advanceTimersByTime(60_000);
    expect(service.toasts().map((t) => t.id)).toEqual([sticky]);
  });

  it('treats invalid explicit durations as defaults and clamps negatives to sticky', () => {
    const nan = service.success('A', { durationMs: Number.NaN });
    const negative = service.success('B', { durationMs: -5 });
    expect(service.toasts().find((t) => t.id === nan)?.durationMs).toBe(4000);
    expect(service.toasts().find((t) => t.id === negative)?.durationMs).toBe(0);
  });

  it('combines the legacy action with the actions array and runs the chosen one', () => {
    const undo = vi.fn();
    const view = vi.fn();
    const id = service.success('Logged yogurt', {
      action: { label: 'Undo', run: undo },
      actions: [{ label: 'View', run: view }],
    });
    const toast = service.toasts()[0]!;
    expect(toast.action?.label).toBe('Undo');
    expect(toast.actions.map((a) => a.label)).toEqual(['Undo', 'View']);
    expect(toast.durationMs).toBe(TOAST_ACTION_DURATION_MS);

    service.runAction(id, 1);
    expect(view).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
    expect(service.toasts()).toEqual([]);
  });

  it('keeps runAction(id) running the first action for existing callers', () => {
    const undo = vi.fn();
    const id = service.success('Deleted', { action: { label: 'Undo', run: undo } });
    service.runAction(id);
    expect(undo).toHaveBeenCalledOnce();
    service.runAction(id);
    expect(undo).toHaveBeenCalledOnce();
  });

  it('pauses while hovered or focused and resumes with a minimum grace period', () => {
    const id = service.success('Saved');
    vi.advanceTimersByTime(3500);
    service.pause(id, 'hover');
    service.pause(id, 'focus');
    expect(service.isPaused(id)).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(service.toasts()).toHaveLength(1);

    service.resume(id, 'hover');
    vi.advanceTimersByTime(30_000);
    expect(service.toasts()).toHaveLength(1);

    service.resume(id, 'focus');
    expect(service.isPaused(id)).toBe(false);
    vi.advanceTimersByTime(TOAST_RESUME_MIN_MS - 1);
    expect(service.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(service.toasts()).toHaveLength(0);
  });

  it('keeps the remaining time when paused early', () => {
    const id = service.error('Failed', { durationMs: 10_000 });
    vi.advanceTimersByTime(2000);
    service.pause(id);
    vi.advanceTimersByTime(5000);
    service.resume(id);
    vi.advanceTimersByTime(7999);
    expect(service.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(service.toasts()).toHaveLength(0);
  });

  it('ignores resume without a matching pause', () => {
    const id = service.success('Saved');
    service.resume(id, 'focus');
    vi.advanceTimersByTime(4000);
    expect(service.toasts()).toHaveLength(0);
  });

  it('freezes timers while the page is hidden', () => {
    service.success('Saved');
    vi.advanceTimersByTime(3900);
    setVisibility('hidden');
    vi.advanceTimersByTime(60_000);
    expect(service.toasts()).toHaveLength(1);
    setVisibility('visible');
    vi.advanceTimersByTime(TOAST_RESUME_MIN_MS - 1);
    expect(service.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(service.toasts()).toHaveLength(0);
  });

  it('announces the newest toast only while it is visible', () => {
    const first = service.success('First');
    expect(service.announcement()?.id).toBe(first);
    const second = service.error('Second');
    expect(service.announcement()?.id).toBe(second);
    service.dismiss(second);
    expect(service.announcement()).toBeNull();
  });

  it('replaces duplicates and caps the number of visible toasts', () => {
    service.success('Same');
    service.success('Same');
    expect(service.toasts()).toHaveLength(1);
    for (let i = 0; i < TOAST_MAX_VISIBLE + 2; i++) {
      service.info(`Message ${i}`);
    }
    expect(service.toasts()).toHaveLength(TOAST_MAX_VISIBLE);
    expect(service.toasts().at(-1)?.message).toBe(`Message ${TOAST_MAX_VISIBLE + 1}`);
  });

  it('lets exactly one live region claim each visible toast', () => {
    const id = service.success('Saved');
    expect(service.claimAnnouncement(id)).toBe(true);
    expect(service.claimAnnouncement(id)).toBe(false);
    const gone = service.info('Gone');
    service.dismiss(gone);
    expect(service.claimAnnouncement(gone)).toBe(false);
    const older = service.info('Older');
    const newer = service.info('Newer');
    expect(service.claimAnnouncement(newer)).toBe(true);
    expect(service.claimAnnouncement(older)).toBe(false);
  });

  it('evicts the oldest auto-dismissing toast before a sticky one', () => {
    const sticky = service.info('Update ready', { durationMs: 0 });
    for (let i = 0; i < TOAST_MAX_VISIBLE; i++) {
      service.success(`Logged ${i}`);
    }
    expect(service.toasts()).toHaveLength(TOAST_MAX_VISIBLE);
    expect(service.toasts()[0]?.id).toBe(sticky);
    expect(service.toasts().map((t) => t.message)).toEqual([
      'Update ready',
      'Logged 1',
      'Logged 2',
    ]);
  });

  it('clears every toast when the session resets', () => {
    const undo = vi.fn();
    service.success('Deleted “Chicken salad”', { action: { label: 'Undo', run: undo } });
    service.info('Saved');
    TestBed.inject(SessionScope).reset();
    expect(service.toasts()).toEqual([]);
    expect(service.announcement()).toBeNull();
    vi.runAllTimers();
    expect(undo).not.toHaveBeenCalled();
    service.error('Your session has expired.');
    expect(service.toasts().map((toast) => toast.message)).toEqual(['Your session has expired.']);
  });
});
