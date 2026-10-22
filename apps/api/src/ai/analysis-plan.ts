import {
  type AnalysisMode,
  type AnalyzeRequestFields,
  API_LIMITS,
  type ImageDetail,
  IMAGE_ROLES,
  type ImageRole,
  type MealType,
} from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import { summarizePreviousResult } from './previous-analysis.js';
import type {
  AnsweredQuestion,
  FollowUpContext,
  FollowUpKind,
} from './prompt.js';

export interface ProfileAiSettings {
  aiModel: string | null;
  aiDetailFood: ImageDetail;
  aiDetailLabel: ImageDetail;
  location: string | null;
}

export const DEFAULT_PROFILE_AI_SETTINGS: ProfileAiSettings = {
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'high',
  location: null,
};

export interface PreviousPhoto {
  photoId: string;
  role: ImageRole;
}

export interface PreviousAnalysis {
  id: string;
  mode: AnalysisMode;
  description: string | null;
  photos: PreviousPhoto[];
  result: unknown;
  answeredQuestions: AnsweredQuestion[];
}

export interface DraftStart {
  id: string;
  description: string | null;
  photos: PreviousPhoto[];
}

export interface AnalyzeRequest extends AnalyzeRequestFields {
  followUpKind?: FollowUpKind;
}

export type ImageUploadField = 'image' | 'images';

export interface ImageUploadSpec {
  field: ImageUploadField;
  role: ImageRole | null;
}

export type PlannedPhotoSource =
  { kind: 'stored'; photoId: string } | { kind: 'upload'; index: number };

export interface PlannedPhoto {
  source: PlannedPhotoSource;
  role: ImageRole;
  detail: ImageDetail;
}

export interface AnalysisPlan {
  mode: AnalysisMode;
  description: string | null;
  detail: ImageDetail | null;
  precise: boolean;
  photos: PlannedPhoto[];
  previousAnalysisId: string | null;
  followUpAnswer: string | null;
  answeredQuestions: AnsweredQuestion[];
  followUp: FollowUpContext | null;
  localTime: string | null;
  mealType: MealType | null;
  split: boolean;
}

type RolePhoto = Omit<PlannedPhoto, 'detail'>;

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function naturalImageRole(mode: AnalysisMode): ImageRole {
  return mode === 'nutrition_label' ? 'label' : 'food';
}

export function isImageRole(value: string): value is ImageRole {
  return (IMAGE_ROLES as readonly string[]).includes(value);
}

export function toImageRole(value: string, mode: AnalysisMode): ImageRole {
  return isImageRole(value) ? value : naturalImageRole(mode);
}

export function carriedPhotos(
  mode: AnalysisMode,
  stored: readonly { photoId: string; role: string }[],
  legacyPhotoId: string | null,
): PreviousPhoto[] {
  if (stored.length > 0) {
    return stored.map(({ photoId, role }) => ({
      photoId,
      role: toImageRole(role, mode),
    }));
  }
  return legacyPhotoId
    ? [{ photoId: legacyPhotoId, role: naturalImageRole(mode) }]
    : [];
}

export function primaryPhoto<T extends { role: ImageRole }>(
  photos: readonly T[],
): T | null {
  return photos.find((photo) => photo.role === 'food') ?? photos[0] ?? null;
}

export function capAnalysisPhotos<T extends { role: ImageRole }>(
  photos: readonly T[],
  max: number = API_LIMITS.analyzeImagesMax,
): T[] {
  if (photos.length <= max) {
    return [...photos];
  }
  const firstFood = photos.findIndex((photo) => photo.role === 'food');
  const others = photos
    .map((_, index) => index)
    .filter((index) => index !== firstFood);
  const kept = new Set(
    firstFood >= 0
      ? [firstFood, ...others.slice(others.length - (max - 1))]
      : others.slice(others.length - max),
  );
  return photos.filter((_, index) => kept.has(index));
}

function missingPhotoMessage(
  mode: AnalysisMode,
  previous: PreviousAnalysis | null,
): string {
  if (previous) {
    return 'The original photo is no longer available — please take a new one';
  }
  return mode === 'nutrition_label'
    ? 'A photo of the nutrition label is required'
    : 'A photo is required for food photo analysis';
}

export function uploadRole(
  upload: ImageUploadSpec,
  mode: AnalysisMode,
  firstPhoto: boolean,
): ImageRole {
  if (upload.role) {
    return upload.role;
  }
  return upload.field === 'image' || firstPhoto
    ? naturalImageRole(mode)
    : 'label';
}

function startingPhotos(
  previous: PreviousAnalysis | null,
  draft: DraftStart | null,
): PreviousPhoto[] {
  const byId = new Map<string, PreviousPhoto>();
  for (const photo of [...(draft?.photos ?? []), ...(previous?.photos ?? [])]) {
    if (!byId.has(photo.photoId)) {
      byId.set(photo.photoId, photo);
    }
  }
  return [...byId.values()];
}

function resolvePhotos(
  mode: AnalysisMode,
  uploads: readonly ImageUploadSpec[],
  previous: PreviousAnalysis | null,
  draft: DraftStart | null,
): RolePhoto[] {
  if (mode === 'text') {
    if (uploads.length > 0) {
      throw new BadRequestException(
        'Text analysis does not take an image — use food_photo mode instead',
      );
    }
    return [];
  }
  const carried: RolePhoto[] = startingPhotos(previous, draft).map((photo) => ({
    source: { kind: 'stored', photoId: photo.photoId },
    role: photo.role,
  }));
  const added: RolePhoto[] = uploads.map((upload, index) => ({
    source: { kind: 'upload', index },
    role: uploadRole(upload, mode, carried.length + index === 0),
  }));
  const photos = capAnalysisPhotos([...carried, ...added]);
  if (photos.length === 0) {
    throw new BadRequestException(missingPhotoMessage(mode, previous));
  }
  return photos;
}

function photoDetail(
  role: ImageRole,
  requested: ImageDetail | undefined,
  profile: ProfileAiSettings,
): ImageDetail {
  if (requested) {
    return requested;
  }
  return role === 'label' ? profile.aiDetailLabel : profile.aiDetailFood;
}

function summaryDetail(photos: readonly PlannedPhoto[]): ImageDetail | null {
  if (photos.length === 0) {
    return null;
  }
  return photos.some((photo) => photo.detail === 'high') ? 'high' : 'low';
}

export function resolveMode(
  request: AnalyzeRequestFields,
  previous: PreviousAnalysis | null,
  uploads: readonly ImageUploadSpec[],
  draft: DraftStart | null = null,
): AnalysisMode {
  const mode = previous?.mode ?? request.mode;
  const draftRoles = (draft?.photos ?? []).map(({ role }) => role);
  const added = [...draftRoles, ...uploads.map(({ role }) => role)];
  const switches = previous ? added.length > 0 : draftRoles.length > 0;
  if (mode !== 'text' || !switches) {
    return mode;
  }
  return added.every((role) => role === 'label')
    ? 'nutrition_label'
    : 'food_photo';
}

export function planAnalysis(
  request: AnalyzeRequest,
  previous: PreviousAnalysis | null,
  uploads: readonly ImageUploadSpec[],
  profile: ProfileAiSettings,
  draft: DraftStart | null = null,
): AnalysisPlan {
  const followUpAnswer = nonEmpty(request.followUpAnswer);
  if (followUpAnswer && !previous) {
    throw new BadRequestException('followUpAnswer requires previousAnalysisId');
  }
  const mode = resolveMode(request, previous, uploads, draft);
  const description =
    nonEmpty(request.description) ??
    previous?.description ??
    nonEmpty(draft?.description) ??
    null;
  const photos = resolvePhotos(mode, uploads, previous, draft).map((photo) => ({
    ...photo,
    detail: photoDetail(photo.role, request.detail, profile),
  }));
  if (mode === 'text' && !description) {
    throw new BadRequestException('Describe what you ate for a text analysis');
  }
  return {
    mode,
    description,
    detail: summaryDetail(photos),
    precise: request.precise === 'true',
    photos,
    previousAnalysisId: previous?.id ?? null,
    followUpAnswer,
    answeredQuestions: previous?.answeredQuestions ?? [],
    followUp:
      previous && followUpAnswer
        ? {
            previous: summarizePreviousResult(previous.result),
            answer: followUpAnswer,
            kind: request.followUpKind ?? 'answer',
          }
        : null,
    localTime: request.localTime ?? null,
    mealType: request.mealType ?? null,
    split: request.split === 'true' && mode === 'text' && !previous && !draft,
  };
}

export function answeredQuestionTexts(plan: AnalysisPlan): string[] {
  const answered =
    plan.followUp?.kind === 'answer' ? plan.followUp.previous.question : null;
  const questions = [
    ...plan.answeredQuestions.map((item) => item.question),
    answered,
  ];
  return questions.filter((question): question is string => question !== null);
}
