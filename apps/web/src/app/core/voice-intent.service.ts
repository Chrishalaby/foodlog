import { Injectable } from '@angular/core';

export const VOICE_INTENT_TTL_MS = 5000;

@Injectable({ providedIn: 'root' })
export class VoiceIntentService {
  private requestedAt: number | null = null;

  request(): void {
    this.requestedAt = Date.now();
  }

  take(): boolean {
    const requestedAt = this.requestedAt;
    this.requestedAt = null;
    return requestedAt !== null && Date.now() - requestedAt <= VOICE_INTENT_TTL_MS;
  }
}
