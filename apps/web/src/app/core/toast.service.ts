import { DOCUMENT, DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { onSessionReset } from './session-scope';

export type ToastKind = 'success' | 'error' | 'info';
export type ToastHoldReason = 'hover' | 'focus';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  actions?: readonly ToastAction[];
  durationMs?: number;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action: ToastAction | null;
  actions: readonly ToastAction[];
  durationMs: number;
  createdAt: number;
}

export const TOAST_DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 5000,
  error: 7000,
};
export const TOAST_ACTION_DURATION_MS = 10000;
export const TOAST_MAX_DURATION_MS = 15000;
export const TOAST_READING_BASE_MS = 1500;
export const TOAST_READING_MS_PER_CHAR = 60;
export const TOAST_RESUME_MIN_MS = 2000;
export const TOAST_MAX_VISIBLE = 3;

export function toastDurationMs(kind: ToastKind, message: string, actionCount: number): number {
  const base = actionCount > 0 ? TOAST_ACTION_DURATION_MS : TOAST_DEFAULT_DURATION_MS[kind];
  const reading = TOAST_READING_BASE_MS + message.length * TOAST_READING_MS_PER_CHAR;
  return Math.min(TOAST_MAX_DURATION_MS, Math.max(base, reading));
}

interface ToastTimer {
  remainingMs: number;
  startedAt: number | null;
  handle: ReturnType<typeof setTimeout> | null;
  holds: Set<ToastHoldReason>;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly document = inject(DOCUMENT);
  private readonly items = signal<readonly Toast[]>([]);
  private readonly latest = signal<Toast | null>(null);
  private readonly timers = new Map<number, ToastTimer>();
  private pageHidden = this.document.visibilityState === 'hidden';
  private nextId = 1;
  private announcedId = 0;

  readonly toasts = this.items.asReadonly();
  readonly announcement = computed(() => {
    const latest = this.latest();
    return latest && this.items().some((t) => t.id === latest.id) ? latest : null;
  });

  constructor() {
    const doc = this.document;
    const onVisibilityChange = (): void => this.setPageHidden(doc.visibilityState === 'hidden');
    doc.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() => {
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      this.clear();
    });
    onSessionReset(() => this.clear());
  }

  success(message: string, options?: ToastOptions): number {
    return this.show('success', message, options);
  }

  error(message: string, options?: ToastOptions): number {
    return this.show('error', message, options);
  }

  info(message: string, options?: ToastOptions): number {
    return this.show('info', message, options);
  }

  show(kind: ToastKind, message: string, options: ToastOptions = {}): number {
    const duplicate = this.items().find((t) => t.kind === kind && t.message === message);
    if (duplicate) {
      this.dismiss(duplicate.id);
    }
    const actions = [...(options.action ? [options.action] : []), ...(options.actions ?? [])];
    const toast: Toast = {
      id: this.nextId++,
      kind,
      message,
      action: actions[0] ?? null,
      actions,
      durationMs: this.resolveDuration(kind, message, actions.length, options.durationMs),
      createdAt: Date.now(),
    };
    this.evictOverflow();
    this.items.update((list) => [...list, toast]);
    this.latest.set(toast);
    if (toast.durationMs > 0) {
      this.timers.set(toast.id, {
        remainingMs: toast.durationMs,
        startedAt: null,
        handle: null,
        holds: new Set(),
      });
      this.schedule(toast.id);
    }
    return toast.id;
  }

  claimAnnouncement(id: number): boolean {
    if (id <= this.announcedId || !this.items().some((t) => t.id === id)) {
      return false;
    }
    this.announcedId = id;
    return true;
  }

  runAction(id: number, index = 0): void {
    const action = this.items().find((t) => t.id === id)?.actions[index];
    this.dismiss(id);
    action?.run();
  }

  pause(id: number, reason: ToastHoldReason = 'hover'): void {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }
    timer.holds.add(reason);
    this.suspend(timer);
  }

  resume(id: number, reason: ToastHoldReason = 'hover'): void {
    const timer = this.timers.get(id);
    if (!timer?.holds.delete(reason) || timer.holds.size > 0) {
      return;
    }
    timer.remainingMs = Math.max(timer.remainingMs, TOAST_RESUME_MIN_MS);
    this.schedule(id);
  }

  isPaused(id: number): boolean {
    const timer = this.timers.get(id);
    return timer !== undefined && timer.handle === null;
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      this.suspend(timer);
      this.timers.delete(id);
    }
    this.items.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    this.timers.forEach((timer) => this.suspend(timer));
    this.timers.clear();
    this.items.set([]);
  }

  private evictOverflow(): void {
    const list = this.items();
    const excess = list.length - TOAST_MAX_VISIBLE + 1;
    if (excess <= 0) {
      return;
    }
    const byPriority = [
      ...list.filter((t) => t.durationMs > 0),
      ...list.filter((t) => t.durationMs <= 0),
    ];
    byPriority.slice(0, excess).forEach((t) => this.dismiss(t.id));
  }

  private resolveDuration(
    kind: ToastKind,
    message: string,
    actionCount: number,
    requested: number | undefined,
  ): number {
    if (requested !== undefined && Number.isFinite(requested)) {
      return Math.max(0, requested);
    }
    return toastDurationMs(kind, message, actionCount);
  }

  private schedule(id: number): void {
    const timer = this.timers.get(id);
    if (!timer || timer.handle !== null || timer.holds.size > 0 || this.pageHidden) {
      return;
    }
    timer.startedAt = Date.now();
    timer.handle = setTimeout(() => this.dismiss(id), timer.remainingMs);
  }

  private suspend(timer: ToastTimer): void {
    if (timer.handle === null) {
      return;
    }
    clearTimeout(timer.handle);
    timer.handle = null;
    const elapsed = timer.startedAt === null ? 0 : Date.now() - timer.startedAt;
    timer.remainingMs = Math.max(0, timer.remainingMs - elapsed);
    timer.startedAt = null;
  }

  private setPageHidden(hidden: boolean): void {
    if (hidden === this.pageHidden) {
      return;
    }
    this.pageHidden = hidden;
    for (const [id, timer] of this.timers) {
      if (hidden) {
        this.suspend(timer);
      } else {
        timer.remainingMs = Math.max(timer.remainingMs, TOAST_RESUME_MIN_MS);
        this.schedule(id);
      }
    }
  }
}
