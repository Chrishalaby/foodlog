import { API_LIMITS, type TranscribeResponse } from '@food/shared';
import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { VoiceThrottlerGuard } from '../common/throttling.js';
import {
  acceptVoiceUpload,
  type UploadedAudio,
  VOICE_AUDIO_FIELD,
} from './voice-upload.js';
import { VoiceService } from './voice.service.js';

const MAX_FORM_FIELDS = 4;
const MAX_FORM_FIELD_BYTES = 1024;

@Controller('transcribe')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(VoiceThrottlerGuard)
  @UseInterceptors(
    FileInterceptor(VOICE_AUDIO_FIELD, {
      limits: {
        fileSize: API_LIMITS.audioMaxBytes,
        files: 1,
        fields: MAX_FORM_FIELDS,
        fieldSize: MAX_FORM_FIELD_BYTES,
        parts: MAX_FORM_FIELDS + 1,
      },
    }),
  )
  transcribe(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: UploadedAudio,
  ): Promise<TranscribeResponse> {
    return this.voice.transcribe(user.id, acceptVoiceUpload(file));
  }
}
