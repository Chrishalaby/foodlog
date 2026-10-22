import type { NoteDto, NoteListResponse } from '@food/shared';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseEntryCursor } from '../entries/entry-query.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PhotosService } from '../photos/photos.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  isEmptyNoteUpdate,
  NOTE_PHOTO_ROLE,
  notePhotoRows,
  noteUpdateData,
} from './note-data.js';
import { NOTE_INCLUDE, type NoteWithPhotos, toNoteDto } from './note-mapper.js';
import {
  DEFAULT_NOTES_PAGE_SIZE,
  noteListOrder,
  noteListWhere,
  toNotePage,
} from './note-query.js';
import type {
  CreateNoteDto,
  NoteListQueryDto,
  UpdateNoteDto,
} from './notes.dto.js';

export const EMPTY_NOTE_MESSAGE = 'Write something or add a photo';
export const NOTE_TEXT_REQUIRED_MESSAGE =
  'A note without a photo needs some text';
export const EMPTY_NOTE_UPDATE_MESSAGE = 'Send text or done to change a note';

type NoteClient = Pick<Prisma.TransactionClient, 'note'>;

function noteNotFound(): NotFoundException {
  return new NotFoundException('Note not found');
}

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
  ) {}

  async list(
    userId: string,
    query: NoteListQueryDto,
  ): Promise<NoteListResponse> {
    const cursor = parseEntryCursor(query.before);
    const limit = query.limit ?? DEFAULT_NOTES_PAGE_SIZE;
    const rows = await this.prisma.note.findMany({
      where: noteListWhere(userId, query, cursor),
      orderBy: noteListOrder(),
      include: NOTE_INCLUDE,
      take: limit + 1,
    });
    const page = toNotePage(rows, limit);
    return { notes: page.rows.map(toNoteDto), nextCursor: page.nextCursor };
  }

  async create(
    userId: string,
    dto: CreateNoteDto,
    uploads: readonly Buffer[],
  ): Promise<NoteDto> {
    const text = dto.text ?? '';
    if (!text && uploads.length === 0) {
      throw new BadRequestException(EMPTY_NOTE_MESSAGE);
    }
    const stored = await this.photos.createManyFromUploads(
      userId,
      uploads.map((buffer) => ({ buffer, role: NOTE_PHOTO_ROLE })),
    );
    const photoIds = stored.map(({ id }) => id);
    try {
      const note = await this.prisma.note.create({
        data: { userId, text, photos: { create: notePhotoRows(photoIds) } },
        include: NOTE_INCLUDE,
      });
      return toNoteDto(note);
    } catch (error) {
      await this.photos.releaseAll(photoIds);
      throw error;
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateNoteDto,
    now: Date = new Date(),
  ): Promise<NoteDto> {
    if (isEmptyNoteUpdate(dto)) {
      throw new BadRequestException(EMPTY_NOTE_UPDATE_MESSAGE);
    }
    const note = await this.prisma.$transaction(async (tx) => {
      const existing = await this.requireNote(tx, userId, id);
      if (dto.text === '' && existing.photos.length === 0) {
        throw new BadRequestException(NOTE_TEXT_REQUIRED_MESSAGE);
      }
      const data = noteUpdateData(dto, existing.done, now);
      if (Object.keys(data).length === 0) {
        return existing;
      }
      return tx.note.update({
        where: { id: existing.id },
        data,
        include: NOTE_INCLUDE,
      });
    });
    return toNoteDto(note);
  }

  async remove(userId: string, id: string): Promise<void> {
    const note = await this.prisma.note.findFirst({
      where: { id, userId },
      select: { id: true, photos: { select: { photoId: true } } },
    });
    if (!note) {
      throw noteNotFound();
    }
    const { count } = await this.prisma.note.deleteMany({
      where: { id: note.id, userId },
    });
    if (count === 0) {
      throw noteNotFound();
    }
    await this.photos.releaseAll(note.photos.map(({ photoId }) => photoId));
  }

  private async requireNote(
    client: NoteClient,
    userId: string,
    id: string,
  ): Promise<NoteWithPhotos> {
    const note = await client.note.findFirst({
      where: { id, userId },
      include: NOTE_INCLUDE,
    });
    if (!note) {
      throw noteNotFound();
    }
    return note;
  }
}
