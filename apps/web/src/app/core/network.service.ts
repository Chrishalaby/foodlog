import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NetworkService {
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly onlineState = signal(this.window?.navigator.onLine ?? true);

  readonly online = this.onlineState.asReadonly();

  constructor() {
    const win = this.window;
    if (!win) {
      return;
    }
    const update = (): void => this.onlineState.set(win.navigator.onLine);
    win.addEventListener('online', update);
    win.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      win.removeEventListener('online', update);
      win.removeEventListener('offline', update);
    });
  }
}
