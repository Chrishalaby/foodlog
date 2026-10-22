import {
  type CanActivate,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';

export const NOTES_DISABLED_MESSAGE = 'Notes are not enabled on this server';

@Injectable()
export class NotesEnabledGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.notesEnabled) {
      throw new NotFoundException(NOTES_DISABLED_MESSAGE);
    }
    return true;
  }
}
