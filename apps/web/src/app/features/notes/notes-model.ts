import { API_LIMITS, toLocalDate, type NoteDto, type NoteStatus } from '@food/shared';
import { relativeDayLabel } from '../../core/time';
import type { ViewerPhoto } from '../../shared/utils/entry-photos';

export const NOTE_TEXT_MAX = API_LIMITS.noteTextMax;
export const NOTE_PHOTOS_MAX = API_LIMITS.notePhotosMax;
export const NOTE_SEARCH_MAX = API_LIMITS.foodQueryMax;
export const NOTE_DRAFT_KEY_PREFIX = 'foodlog.notes.draft.';
export const NOTE_DRAFT_GUEST = 'guest';
export const SHARE_PARAMS = ['title', 'text', 'url'] as const;

export type NoteSendState = 'sent' | 'sending' | 'failed';

export interface NotePhoto {
  readonly id: string;
  readonly url: string;
  readonly thumbUrl: string;
  readonly width: number;
  readonly height: number;
}

export interface NoteAttachment {
  readonly id: string;
  readonly blob: Blob;
  readonly previewUrl: string | null;
  readonly width: number;
  readonly height: number;
}

export interface OutboxNote {
  readonly key: string;
  readonly text: string;
  readonly attachments: readonly NoteAttachment[];
  readonly createdAt: string;
  readonly state: 'sending' | 'failed';
  readonly error: string | null;
}

export interface FeedNote {
  readonly key: string;
  readonly id: string | null;
  readonly text: string;
  readonly photos: readonly NotePhoto[];
  readonly done: boolean;
  readonly createdAt: string;
  readonly state: NoteSendState;
  readonly error: string | null;
}

export interface FeedDay {
  readonly date: string;
  readonly label: string;
  readonly notes: readonly FeedNote[];
}

export interface TextSegment {
  readonly text: string;
  readonly href: string | null;
}

export interface SharePayload {
  readonly title?: string | null;
  readonly text?: string | null;
  readonly url?: string | null;
}

export interface NoteFilterOption {
  readonly value: NoteStatus;
  readonly label: string;
}

export const NOTE_FILTERS: readonly NoteFilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'To do' },
  { value: 'done', label: 'Done' },
];

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?…]+$/;
const BRACKET_PAIRS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING_PUNCTUATION, '');
  for (;;) {
    const open = BRACKET_PAIRS[url.slice(-1)];
    if (!open || count(url, open) >= count(url, url.slice(-1))) {
      return url;
    }
    url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, '');
  }
}

function isWebUrl(value: string): boolean {
  try {
    return new URL(value).hostname.length > 0;
  } catch {
    return false;
  }
}

export function linkSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (!isWebUrl(url)) {
      continue;
    }
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), href: null });
    }
    segments.push({ text: url, href: url });
    cursor = match.index + url.length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), href: null });
  }
  return segments;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function hasSharePayload(payload: SharePayload): boolean {
  return SHARE_PARAMS.some((key) => clean(payload[key]) !== '');
}

export function shareText(payload: SharePayload): string {
  const title = clean(payload.title);
  const text = clean(payload.text);
  const url = clean(payload.url);
  const parts: string[] = [];
  if (title && title !== url && !text.includes(title)) {
    parts.push(title);
  }
  if (text) {
    parts.push(text);
  }
  if (url && !text.includes(url)) {
    parts.push(url);
  }
  return parts.join('\n');
}

export function mergeShareText(
  existing: string,
  payload: SharePayload,
  max: number = NOTE_TEXT_MAX,
): string {
  const shared = shareText(payload);
  const base = existing.trimEnd();
  if (!shared || base.includes(shared)) {
    return existing;
  }
  return (base ? `${base}\n${shared}` : shared).slice(0, max);
}

export function noteDraftKey(userId: string | null): string {
  return `${NOTE_DRAFT_KEY_PREFIX}${userId ?? NOTE_DRAFT_GUEST}`;
}

export function readNoteDraft(storage: Storage | null, userId: string | null): string {
  try {
    return (storage?.getItem(noteDraftKey(userId)) ?? '').slice(0, NOTE_TEXT_MAX);
  } catch {
    return '';
  }
}

export function writeNoteDraft(storage: Storage | null, userId: string | null, text: string): void {
  try {
    if (text.trim() === '') {
      storage?.removeItem(noteDraftKey(userId));
    } else {
      storage?.setItem(noteDraftKey(userId), text);
    }
  } catch {
    return;
  }
}

export function noteLocalDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : toLocalDate(date);
}

export function groupNotesByDay(notes: readonly FeedNote[], now: Date = new Date()): FeedDay[] {
  const today = toLocalDate(now);
  const days: { date: string; label: string; notes: FeedNote[] }[] = [];
  for (const note of notes) {
    const date = noteLocalDate(note.createdAt);
    const last = days.at(-1);
    if (last && date <= last.date) {
      last.notes.push(note);
    } else {
      days.push({ date, label: relativeDayLabel(date, today), notes: [note] });
    }
  }
  return days;
}

export function oldestFirst(notes: readonly NoteDto[]): NoteDto[] {
  return [...notes].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export function sentNote(note: NoteDto, key: string = note.id): FeedNote {
  return {
    key,
    id: note.id,
    text: note.text,
    photos: note.photos,
    done: note.done,
    createdAt: note.createdAt,
    state: 'sent',
    error: null,
  };
}

export function outboxNote(note: OutboxNote): FeedNote {
  return {
    key: note.key,
    id: null,
    text: note.text,
    photos: note.attachments.map((photo) => ({
      id: photo.id,
      url: photo.previewUrl ?? '',
      thumbUrl: photo.previewUrl ?? '',
      width: photo.width,
      height: photo.height,
    })),
    done: false,
    createdAt: note.createdAt,
    state: note.state,
    error: note.error,
  };
}

export function noteViewerPhotos(note: FeedNote): ViewerPhoto[] {
  const caption = note.text.trim() || null;
  return note.photos.map((photo, index) => ({
    id: photo.id,
    url: photo.url,
    alt: note.photos.length > 1 ? `Note photo ${index + 1}` : 'Note photo',
    caption,
  }));
}

export function photosLeftOutMessage(leftOut: number, max: number = NOTE_PHOTOS_MAX): string {
  const photos = leftOut === 1 ? '1 photo was' : `${leftOut} photos were`;
  return `A note holds up to ${max} photos. ${photos} left out.`;
}

export function emptyFeedMessage(query: string, status: NoteStatus): string {
  if (query) {
    return `No notes match “${query}”.`;
  }
  return status === 'done' ? 'Nothing ticked off yet.' : 'Nothing left to do.';
}
