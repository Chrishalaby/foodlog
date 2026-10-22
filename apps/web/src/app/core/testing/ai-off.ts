import { signal } from '@angular/core';
import { AiAvailability } from '../ai-availability.service';

export function aiOff() {
  return { provide: AiAvailability, useValue: { enabled: signal(false), voice: signal(false) } };
}
