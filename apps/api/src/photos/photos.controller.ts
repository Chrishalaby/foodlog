import type { Readable } from 'node:stream';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SkipBurstThrottler } from '../common/throttling.js';
import { PhotosService } from './photos.service.js';

export const PHOTO_CACHE_CONTROL = 'private, max-age=31536000, immutable';

function streamImage(
  response: Response,
  stream: Readable,
  contentType: string,
): StreamableFile {
  response.setHeader('Cache-Control', PHOTO_CACHE_CONTROL);
  response.once('close', () => stream.destroy());
  return new StreamableFile(stream, { type: contentType });
}

@Controller('photos')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get(':id')
  async full(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const photo = await this.photos.findOwned(user.id, id);
    return streamImage(
      response,
      await this.photos.openFull(photo),
      'image/jpeg',
    );
  }

  @SkipBurstThrottler()
  @Get(':id/thumb')
  async thumb(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const photo = await this.photos.findOwned(user.id, id);
    return streamImage(
      response,
      await this.photos.openThumb(photo),
      'image/webp',
    );
  }
}
