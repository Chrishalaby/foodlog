import { Injectable, signal } from '@angular/core';
import { onSessionReset } from '../../core/session-scope';

export type ConfirmTone = 'default' | 'danger';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

export interface ConfirmRequest {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmTone;
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly pending = signal<PendingConfirm | null>(null);
  private nextId = 1;

  readonly current = this.pending.asReadonly();

  constructor() {
    onSessionReset(() => this.cancelPending());
  }

  confirm(options: ConfirmOptions): Promise<boolean> {
    this.pending()?.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.pending.set({
        id: this.nextId++,
        title: options.title,
        message: options.message ?? '',
        confirmLabel: options.confirmLabel ?? 'Confirm',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        tone: options.tone ?? 'default',
        resolve,
      });
    });
  }

  settle(id: number, confirmed: boolean): void {
    const request = this.pending();
    if (request?.id !== id) {
      return;
    }
    this.pending.set(null);
    request.resolve(confirmed);
  }

  private cancelPending(): void {
    const request = this.pending();
    if (request) {
      this.settle(request.id, false);
    }
  }
}
