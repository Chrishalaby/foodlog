import {
  DOCUMENT,
  DestroyRef,
  Injectable,
  computed,
  inject,
  linkedSignal,
  resource,
  untracked,
} from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { SessionScope } from './session-scope';

@Injectable({ providedIn: 'root' })
export class AdminPendingService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly scope = inject(SessionScope);
  private readonly overview = resource({
    params: () => (this.auth.isAdmin() ? { epoch: this.scope.epoch() } : undefined),
    loader: () => this.api.adminOverview(),
  });
  private readonly pending = linkedSignal(() =>
    this.overview.hasValue() ? this.overview.value().pendingRequests : 0,
  );

  readonly count = computed(() => (this.auth.isAdmin() ? this.pending() : 0));

  constructor() {
    const doc = inject(DOCUMENT);
    const onVisibilityChange = (): void => {
      if (doc.visibilityState === 'visible') {
        this.reload();
      }
    };
    doc.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() =>
      doc.removeEventListener('visibilitychange', onVisibilityChange),
    );
  }

  reload(): void {
    if (untracked(this.auth.isAdmin)) {
      this.overview.reload();
    }
  }

  set(count: number): void {
    this.pending.set(Math.max(0, count));
  }
}
