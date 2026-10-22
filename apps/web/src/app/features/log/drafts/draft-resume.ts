import { Injectable, signal } from '@angular/core';
import { onSessionReset } from '../../../core/session-scope';
import type { DraftSource } from './draft-rows';

export interface DraftResumeRequest {
  readonly id: number;
  readonly source: DraftSource;
  readonly analyze: boolean;
}

@Injectable({ providedIn: 'root' })
export class DraftResumeHandoff {
  private readonly state = signal<DraftResumeRequest | null>(null);
  private seq = 0;

  readonly pending = this.state.asReadonly();

  constructor() {
    onSessionReset(() => this.state.set(null));
  }

  offer(source: DraftSource, analyze = false): DraftResumeRequest {
    const request: DraftResumeRequest = { id: ++this.seq, source, analyze };
    this.state.set(request);
    return request;
  }

  take(): DraftResumeRequest | null {
    const request = this.state();
    this.state.set(null);
    return request;
  }

  withdraw(request: DraftResumeRequest): void {
    if (this.state() === request) {
      this.state.set(null);
    }
  }
}
