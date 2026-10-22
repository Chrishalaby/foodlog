import { Injectable, computed, inject } from '@angular/core';
import { ProfileStore } from './profile.store';

@Injectable({ providedIn: 'root' })
export class AiAvailability {
  private readonly profile = inject(ProfileStore);

  readonly enabled = computed(() => this.profile.ai()?.provider !== 'unconfigured');
  readonly voice = computed(() => this.enabled() && this.profile.ai()?.voice !== false);
}
