import { Injectable } from '@angular/core';
import type { ProfileDto } from '@food/shared';
import { onSessionReset } from '../../core/session-scope';
import {
  type ProfileFormModel,
  rebaseProfile,
  sameProfile,
  toFormModel,
  toProfileDto,
} from './profile-model';

export interface SettingsDraft {
  userId: string | null;
  serverProfile: ProfileDto;
  baseline: ProfileDto;
  model: ProfileFormModel;
}

export function rebaseDraft(draft: SettingsDraft, serverProfile: ProfileDto): SettingsDraft {
  if (sameProfile(draft.serverProfile, serverProfile)) {
    return draft;
  }
  const baseline: ProfileDto = { ...serverProfile, theme: draft.baseline.theme };
  return {
    userId: draft.userId,
    serverProfile,
    baseline,
    model: toFormModel(rebaseProfile(draft.baseline, toProfileDto(draft.model), baseline)),
  };
}

@Injectable({ providedIn: 'root' })
export class SettingsDraftStore {
  private draft: SettingsDraft | null = null;

  constructor() {
    onSessionReset(() => this.clear());
  }

  keep(draft: SettingsDraft): void {
    this.draft = draft;
  }

  clear(): void {
    this.draft = null;
  }

  restore(userId: string | null, serverProfile: ProfileDto): SettingsDraft | null {
    const draft = this.draft;
    this.draft = null;
    if (!draft || draft.userId !== userId) {
      return null;
    }
    return rebaseDraft(draft, serverProfile);
  }
}
