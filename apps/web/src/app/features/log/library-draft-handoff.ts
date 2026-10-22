import { Injectable } from '@angular/core';
import { onSessionReset } from '../../core/session-scope';
import type { LibraryDraft } from './log.store';

@Injectable({ providedIn: 'root' })
export class LibraryDraftHandoff {
  private draft: LibraryDraft | null = null;

  constructor() {
    onSessionReset(() => {
      this.draft = null;
    });
  }

  offer(draft: LibraryDraft): void {
    this.draft = draft;
  }

  take(): LibraryDraft | null {
    const draft = this.draft;
    this.draft = null;
    return draft;
  }
}
