import { DestroyRef, Injectable, inject } from '@angular/core';

export type UnsavedWorkCheck = () => boolean;

@Injectable({ providedIn: 'root' })
export class UnsavedWorkService {
  private readonly checks = new Set<UnsavedWorkCheck>();

  register(check: UnsavedWorkCheck, destroyRef: DestroyRef): () => void {
    const entry: UnsavedWorkCheck = () => check();
    this.checks.add(entry);
    const remove = (): void => {
      this.checks.delete(entry);
    };
    destroyRef.onDestroy(remove);
    return remove;
  }

  hasUnsavedWork(): boolean {
    return [...this.checks].some((check) => check());
  }
}

export function registerUnsavedWork(check: UnsavedWorkCheck): () => void {
  return inject(UnsavedWorkService).register(check, inject(DestroyRef));
}
