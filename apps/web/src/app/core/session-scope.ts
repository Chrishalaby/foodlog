import { DestroyRef, ErrorHandler, Injectable, inject, signal } from '@angular/core';

export type SessionResetHandler = () => void;

@Injectable({ providedIn: 'root' })
export class SessionScope {
  private readonly errors = inject(ErrorHandler);
  private readonly handlers = new Set<SessionResetHandler>();
  private readonly epochState = signal(0);

  readonly epoch = this.epochState.asReadonly();

  onReset(handler: SessionResetHandler, destroyRef?: DestroyRef): () => void {
    const entry: SessionResetHandler = () => handler();
    this.handlers.add(entry);
    const remove = (): void => {
      this.handlers.delete(entry);
    };
    destroyRef?.onDestroy(remove);
    return remove;
  }

  reset(): void {
    this.epochState.update((epoch) => epoch + 1);
    for (const handler of [...this.handlers]) {
      try {
        handler();
      } catch (error) {
        this.errors.handleError(error);
      }
    }
  }
}

export function onSessionReset(handler: SessionResetHandler): () => void {
  return inject(SessionScope).onReset(handler, inject(DestroyRef));
}
