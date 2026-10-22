import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AcceptAccessRequest,
  AcceptAuthTokenRequest,
  AccessRequestStatus,
  AccessRequestStatusRequest,
  AccessRequestStatusResponse,
  AdminAccessRequestDto,
  AdminInviteDto,
  AdminOverviewResponse,
  AdminUserDto,
  AiProviderResponse,
  AnalyzeRequestFields,
  AuthTokenInfoResponse,
  BarcodeLookupResponse,
  CatalogFoodDto,
  CatalogInfoResponse,
  CatalogSearchQuery,
  CatalogSearchResponse,
  DemoStartRequest,
  ImportBatchRequest,
  ImportBatchResponse,
  CreateAccessRequest,
  CreateAccessRequestResponse,
  CreateDraftFields,
  CreateFluidLogRequest,
  CreateInviteRequest,
  DismissFoodMergeRequest,
  DraftDto,
  FluidDayResponse,
  FluidLogDto,
  FoodMergeSuggestionsResponse,
  InviteLinkResponse,
  LogDraftRequest,
  LogProductRequest,
  MealIdeasRequest,
  MealIdeasResponse,
  MenuScanFields,
  MenuScanResponse,
  MergeFoodsRequest,
  MyFoodChangeResponse,
  MyFoodDto,
  MyFoodsQuery,
  NoteDto,
  NoteListQuery,
  NoteListResponse,
  ProductDto,
  SaveMyFoodRequest,
  SessionDto,
  UpdateAccountRequest,
  UpdateDraftRequest,
  UpdateFluidLogRequest,
  UpdateAdminUserRequest,
  UpdateAiProviderRequest,
  TestAiProviderResponse,
  UpdateMyFoodRequest,
  UpdateNoteRequest,
  UpsertProductRequest,
  AnalyzeResponse,
  AuthStatusResponse,
  ChangePasswordRequest,
  CreateEntryRequest,
  CreateFavoriteFromEntryRequest,
  CreateFavoriteRequest,
  DayDashboardResponse,
  DayMetaDto,
  DuplicateEntryRequest,
  EntryDto,
  EntryListQuery,
  EntryListResponse,
  EntryRawAiResponse,
  ExportFormat,
  FoodRenameRequest,
  FoodRenameResponse,
  FoodSearchQuery,
  FoodSearchResponse,
  FavoriteDto,
  HealthResponse,
  HiddenFoodsResponse,
  HideFoodRequest,
  InsightsResponse,
  LogFavoriteRequest,
  LoginRequest,
  ProfileResponse,
  QuickLogRequest,
  RangeDashboardResponse,
  SetupRequest,
  TranscribeResponse,
  UpdateDayMetaRequest,
  UpdateEntryRequest,
  UpdateFavoriteRequest,
  UpdateProfileRequest,
  UpsertWeightRequest,
  UsageSummaryResponse,
  UserDto,
  WeightLogDto,
  WeightSummaryResponse,
  ImageRole,
} from '@food/shared';
import { Observable, firstValueFrom, fromEvent, takeUntil } from 'rxjs';

export const API_BASE = '/api';
export const ANALYZE_IMAGES_FIELD = 'images';
export const ANALYZE_ROLES_FIELD = 'imageRoles';

export interface AnalyzeImage {
  blob: Blob;
  role: ImageRole;
}

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Readonly<Record<string, QueryValue>>;

export interface InsightsQuery {
  to?: string;
  days?: number;
}

export function toHttpParams(query: object = {}): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query as QueryParams)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}

export function analyzeImageFilename(index: number): string {
  return `photo-${index + 1}.jpg`;
}

export const VOICE_AUDIO_FIELD = 'audio';
export const NOTE_IMAGES_FIELD = 'images';

export function buildNoteFormData(text: string, images: readonly Blob[] = []): FormData {
  const body = new FormData();
  body.append('text', text);
  images.forEach((image, index) =>
    body.append(NOTE_IMAGES_FIELD, image, analyzeImageFilename(index)),
  );
  return body;
}

const VOICE_EXTENSIONS: readonly (readonly [string, string])[] = [
  ['mp4', 'm4a'],
  ['m4a', 'm4a'],
  ['aac', 'm4a'],
  ['webm', 'webm'],
  ['ogg', 'ogg'],
  ['wav', 'wav'],
  ['mpeg', 'mp3'],
];

export function voiceFilename(mimeType: string): string {
  const type = mimeType.toLowerCase();
  const match = VOICE_EXTENSIONS.find(([token]) => type.includes(token));
  return `voice.${match?.[1] ?? 'webm'}`;
}

export function buildAnalyzeFormData(
  fields: AnalyzeRequestFields | CreateDraftFields | MenuScanFields,
  images: readonly AnalyzeImage[] = [],
): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields) as [string, string | undefined][]) {
    if (value !== undefined && key !== ANALYZE_ROLES_FIELD) {
      body.append(key, value);
    }
  }
  if (images.length > 0) {
    body.append(ANALYZE_ROLES_FIELD, images.map((image) => image.role).join(','));
  }
  images.forEach((image, index) =>
    body.append(ANALYZE_IMAGES_FIELD, image.blob, analyzeImageFilename(index)),
  );
  return body;
}

const segment = (value: string): string => encodeURIComponent(value);

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  health(): Promise<HealthResponse> {
    return this.get<HealthResponse>('/health');
  }

  startDemo(body: DemoStartRequest): Promise<UserDto> {
    return this.post<UserDto>('/demo/start', body);
  }

  authStatus(): Promise<AuthStatusResponse> {
    return this.get<AuthStatusResponse>('/auth/status');
  }

  setup(body: SetupRequest): Promise<UserDto> {
    return this.post<UserDto>('/auth/setup', body);
  }

  login(body: LoginRequest): Promise<UserDto> {
    return this.post<UserDto>('/auth/login', body);
  }

  logout(): Promise<void> {
    return this.postVoid('/auth/logout', {});
  }

  changePassword(body: ChangePasswordRequest): Promise<void> {
    return this.postVoid('/auth/change-password', body);
  }

  analyze(
    fields: AnalyzeRequestFields,
    images: readonly AnalyzeImage[] = [],
  ): Promise<AnalyzeResponse> {
    return this.post<AnalyzeResponse>('/analyze', buildAnalyzeFormData(fields, images));
  }

  transcribe(audio: Blob): Promise<TranscribeResponse> {
    const body = new FormData();
    body.append(VOICE_AUDIO_FIELD, audio, voiceFilename(audio.type));
    return this.post<TranscribeResponse>('/transcribe', body);
  }

  listNotes(query: NoteListQuery = {}): Promise<NoteListResponse> {
    return this.get<NoteListResponse>('/notes', query);
  }

  createNote(text: string, images: readonly Blob[] = []): Promise<NoteDto> {
    return this.post<NoteDto>('/notes', buildNoteFormData(text, images));
  }

  updateNote(id: string, body: UpdateNoteRequest): Promise<NoteDto> {
    return this.patch<NoteDto>(`/notes/${segment(id)}`, body);
  }

  deleteNote(id: string): Promise<void> {
    return this.deleteVoid(`/notes/${segment(id)}`);
  }

  listDrafts(): Promise<DraftDto[]> {
    return this.get<DraftDto[]>('/drafts');
  }

  createDraft(fields: CreateDraftFields, images: readonly AnalyzeImage[] = []): Promise<DraftDto> {
    return this.post<DraftDto>('/drafts', buildAnalyzeFormData(fields, images));
  }

  updateDraft(id: string, body: UpdateDraftRequest): Promise<DraftDto> {
    return this.put<DraftDto>(`/drafts/${segment(id)}`, body);
  }

  deleteDraft(id: string): Promise<void> {
    return this.deleteVoid(`/drafts/${segment(id)}`);
  }

  logDraft(id: string, body: LogDraftRequest): Promise<EntryDto> {
    return this.post<EntryDto>(`/drafts/${segment(id)}/log`, body);
  }

  scanMenu(fields: MenuScanFields, images: readonly AnalyzeImage[]): Promise<MenuScanResponse> {
    return this.post<MenuScanResponse>('/compare/menu', buildAnalyzeFormData(fields, images));
  }

  mealIdeas(body: MealIdeasRequest): Promise<MealIdeasResponse> {
    return this.post<MealIdeasResponse>('/meal-ideas', body);
  }

  photoUrl(photoId: string): string {
    return `${API_BASE}/photos/${segment(photoId)}`;
  }

  photoThumbUrl(photoId: string): string {
    return `${API_BASE}/photos/${segment(photoId)}/thumb`;
  }

  listEntries(query: EntryListQuery = {}): Promise<EntryListResponse> {
    return this.get<EntryListResponse>('/entries', query);
  }

  getEntry(id: string): Promise<EntryDto> {
    return this.get<EntryDto>(`/entries/${segment(id)}`);
  }

  getEntryRawAi(id: string): Promise<EntryRawAiResponse> {
    return this.get<EntryRawAiResponse>(`/entries/${segment(id)}/raw-ai`);
  }

  createEntry(body: CreateEntryRequest): Promise<EntryDto> {
    return this.post<EntryDto>('/entries', body);
  }

  updateEntry(id: string, body: UpdateEntryRequest): Promise<EntryDto> {
    return this.put<EntryDto>(`/entries/${segment(id)}`, body);
  }

  deleteEntry(id: string): Promise<void> {
    return this.deleteVoid(`/entries/${segment(id)}`);
  }

  duplicateEntry(id: string, body: DuplicateEntryRequest): Promise<EntryDto> {
    return this.post<EntryDto>(`/entries/${segment(id)}/duplicate`, body);
  }

  listFavorites(): Promise<FavoriteDto[]> {
    return this.get<FavoriteDto[]>('/favorites');
  }

  createFavorite(body: CreateFavoriteRequest): Promise<FavoriteDto> {
    return this.post<FavoriteDto>('/favorites', body);
  }

  createFavoriteFromEntry(
    entryId: string,
    body: CreateFavoriteFromEntryRequest = {},
  ): Promise<FavoriteDto> {
    return this.post<FavoriteDto>(`/favorites/from-entry/${segment(entryId)}`, body);
  }

  updateFavorite(id: string, body: UpdateFavoriteRequest): Promise<FavoriteDto> {
    return this.put<FavoriteDto>(`/favorites/${segment(id)}`, body);
  }

  deleteFavorite(id: string): Promise<void> {
    return this.deleteVoid(`/favorites/${segment(id)}`);
  }

  logFavorite(id: string, body: LogFavoriteRequest): Promise<EntryDto> {
    return this.post<EntryDto>(`/favorites/${segment(id)}/log`, body);
  }

  searchFoods(query: FoodSearchQuery = {}, signal?: AbortSignal): Promise<FoodSearchResponse> {
    return this.get<FoodSearchResponse>('/foods', query, signal);
  }

  renameFood(body: FoodRenameRequest): Promise<FoodRenameResponse> {
    return this.post<FoodRenameResponse>('/foods/rename', body);
  }

  hiddenFoods(): Promise<HiddenFoodsResponse> {
    return this.get<HiddenFoodsResponse>('/foods/hidden');
  }

  hideFood(body: HideFoodRequest): Promise<HiddenFoodsResponse> {
    return this.post<HiddenFoodsResponse>('/foods/hidden', body);
  }

  unhideFood(name: string): Promise<HiddenFoodsResponse> {
    return this.send(
      this.http.delete<HiddenFoodsResponse>(this.url('/foods/hidden'), {
        params: toHttpParams({ name }),
      }),
    );
  }

  quickLog(body: QuickLogRequest): Promise<EntryDto> {
    return this.post<EntryDto>('/foods/log', body);
  }

  catalogInfo(): Promise<CatalogInfoResponse> {
    return this.get<CatalogInfoResponse>('/catalog');
  }

  searchCatalog(query: CatalogSearchQuery, signal?: AbortSignal): Promise<CatalogSearchResponse> {
    return this.get<CatalogSearchResponse>('/catalog/foods', query, signal);
  }

  catalogFood(id: number): Promise<CatalogFoodDto> {
    return this.get<CatalogFoodDto>(`/catalog/foods/${segment(String(id))}`);
  }

  weights(from: string, to: string): Promise<WeightSummaryResponse> {
    return this.get<WeightSummaryResponse>('/weights', { from, to });
  }

  putWeight(date: string, body: UpsertWeightRequest): Promise<WeightLogDto> {
    return this.put<WeightLogDto>(`/weights/${segment(date)}`, body);
  }

  deleteWeight(date: string): Promise<void> {
    return this.deleteVoid(`/weights/${segment(date)}`);
  }

  getDay(date: string): Promise<DayMetaDto> {
    return this.get<DayMetaDto>(`/days/${segment(date)}`);
  }

  putDay(date: string, body: UpdateDayMetaRequest): Promise<DayMetaDto> {
    return this.put<DayMetaDto>(`/days/${segment(date)}`, body);
  }

  getProfile(): Promise<ProfileResponse> {
    return this.get<ProfileResponse>('/profile');
  }

  putProfile(body: UpdateProfileRequest): Promise<ProfileResponse> {
    return this.put<ProfileResponse>('/profile', body);
  }

  fluidDay(date: string): Promise<FluidDayResponse> {
    return this.get<FluidDayResponse>('/fluids', { date });
  }

  createFluid(body: CreateFluidLogRequest): Promise<FluidLogDto> {
    return this.post<FluidLogDto>('/fluids', body);
  }

  updateFluid(id: string, body: UpdateFluidLogRequest): Promise<FluidLogDto> {
    return this.put<FluidLogDto>(`/fluids/${segment(id)}`, body);
  }

  deleteFluid(id: string): Promise<void> {
    return this.deleteVoid(`/fluids/${segment(id)}`);
  }

  dayDashboard(date: string): Promise<DayDashboardResponse> {
    return this.get<DayDashboardResponse>('/dashboard/day', { date });
  }

  rangeDashboard(from: string, to: string): Promise<RangeDashboardResponse> {
    return this.get<RangeDashboardResponse>('/dashboard/range', { from, to });
  }

  insights(query: InsightsQuery = {}): Promise<InsightsResponse> {
    return this.get<InsightsResponse>('/insights', query);
  }

  usage(month?: string): Promise<UsageSummaryResponse> {
    return this.get<UsageSummaryResponse>('/usage', { month });
  }

  requestAccess(body: CreateAccessRequest): Promise<CreateAccessRequestResponse> {
    return this.post<CreateAccessRequestResponse>('/access-requests', body);
  }

  accessRequestStatus(body: AccessRequestStatusRequest): Promise<AccessRequestStatusResponse> {
    return this.post<AccessRequestStatusResponse>('/access-requests/status', body);
  }

  acceptAccessRequest(body: AcceptAccessRequest): Promise<UserDto> {
    return this.post<UserDto>('/access-requests/accept', body);
  }

  authTokenInfo(token: string): Promise<AuthTokenInfoResponse> {
    return this.get<AuthTokenInfoResponse>(`/auth/tokens/${segment(token)}`);
  }

  acceptAuthToken(token: string, body: AcceptAuthTokenRequest): Promise<UserDto> {
    return this.post<UserDto>(`/auth/tokens/${segment(token)}/accept`, body);
  }

  sessions(): Promise<SessionDto[]> {
    return this.get<SessionDto[]>('/auth/sessions');
  }

  revokeSession(id: string): Promise<void> {
    return this.deleteVoid(`/auth/sessions/${segment(id)}`);
  }

  updateAccount(body: UpdateAccountRequest): Promise<UserDto> {
    return this.put<UserDto>('/auth/account', body);
  }

  adminOverview(): Promise<AdminOverviewResponse> {
    return this.get<AdminOverviewResponse>('/admin/overview');
  }

  adminUsers(): Promise<AdminUserDto[]> {
    return this.get<AdminUserDto[]>('/admin/users');
  }

  adminUpdateUser(id: string, body: UpdateAdminUserRequest): Promise<AdminUserDto> {
    return this.patch<AdminUserDto>(`/admin/users/${segment(id)}`, body);
  }

  adminResetLink(id: string): Promise<InviteLinkResponse> {
    return this.post<InviteLinkResponse>(`/admin/users/${segment(id)}/reset-link`, {});
  }

  adminRevokeSessions(id: string): Promise<void> {
    return this.postVoid(`/admin/users/${segment(id)}/revoke-sessions`, {});
  }

  adminDeleteUser(id: string): Promise<void> {
    return this.deleteVoid(`/admin/users/${segment(id)}`);
  }

  adminAccessRequests(status?: AccessRequestStatus): Promise<AdminAccessRequestDto[]> {
    return this.get<AdminAccessRequestDto[]>('/admin/access-requests', { status });
  }

  adminApproveRequest(id: string): Promise<InviteLinkResponse> {
    return this.post<InviteLinkResponse>(`/admin/access-requests/${segment(id)}/approve`, {});
  }

  adminRejectRequest(id: string): Promise<AdminAccessRequestDto> {
    return this.post<AdminAccessRequestDto>(`/admin/access-requests/${segment(id)}/reject`, {});
  }

  adminInvites(): Promise<AdminInviteDto[]> {
    return this.get<AdminInviteDto[]>('/admin/invites');
  }

  adminCreateInvite(body: CreateInviteRequest): Promise<InviteLinkResponse> {
    return this.post<InviteLinkResponse>('/admin/invites', body);
  }

  adminRegenerateInvite(id: string): Promise<InviteLinkResponse> {
    return this.post<InviteLinkResponse>(`/admin/invites/${segment(id)}/regenerate`, {});
  }

  adminRevokeInvite(id: string): Promise<void> {
    return this.deleteVoid(`/admin/invites/${segment(id)}`);
  }

  adminAiProvider(): Promise<AiProviderResponse> {
    return this.get<AiProviderResponse>('/admin/ai-provider');
  }

  adminSaveAiProvider(body: UpdateAiProviderRequest): Promise<AiProviderResponse> {
    return this.put<AiProviderResponse>('/admin/ai-provider', body);
  }

  adminRemoveAiProvider(): Promise<AiProviderResponse> {
    return this.delete<AiProviderResponse>('/admin/ai-provider');
  }

  adminTestAiProvider(body: UpdateAiProviderRequest): Promise<TestAiProviderResponse> {
    return this.post<TestAiProviderResponse>('/admin/ai-provider/test', body);
  }

  lookupBarcode(code: string, signal?: AbortSignal): Promise<BarcodeLookupResponse> {
    return this.get<BarcodeLookupResponse>(`/products/barcode/${segment(code)}`, undefined, signal);
  }

  upsertProduct(code: string, body: UpsertProductRequest): Promise<ProductDto> {
    return this.put<ProductDto>(`/products/barcode/${segment(code)}`, body);
  }

  listProducts(): Promise<ProductDto[]> {
    return this.get<ProductDto[]>('/products');
  }

  deleteProduct(id: string): Promise<void> {
    return this.deleteVoid(`/products/${segment(id)}`);
  }

  logProduct(id: string, body: LogProductRequest): Promise<EntryDto> {
    return this.post<EntryDto>(`/products/${segment(id)}/log`, body);
  }

  listMyFoods(query: MyFoodsQuery = {}): Promise<MyFoodDto[]> {
    return this.get<MyFoodDto[]>('/my-foods', query);
  }

  createMyFood(body: SaveMyFoodRequest): Promise<MyFoodDto> {
    return this.post<MyFoodDto>('/my-foods', body);
  }

  updateMyFood(id: string, body: UpdateMyFoodRequest): Promise<MyFoodChangeResponse> {
    return this.put<MyFoodChangeResponse>(`/my-foods/${segment(id)}`, body);
  }

  deleteMyFood(id: string): Promise<void> {
    return this.deleteVoid(`/my-foods/${segment(id)}`);
  }

  foodMergeSuggestions(): Promise<FoodMergeSuggestionsResponse> {
    return this.get<FoodMergeSuggestionsResponse>('/my-foods/suggestions');
  }

  mergeFoods(body: MergeFoodsRequest): Promise<MyFoodChangeResponse> {
    return this.post<MyFoodChangeResponse>('/my-foods/merge', body);
  }

  dismissFoodMerge(body: DismissFoodMergeRequest): Promise<void> {
    return this.postVoid('/my-foods/suggestions/dismiss', body);
  }

  importBatch(body: ImportBatchRequest): Promise<ImportBatchResponse> {
    return this.post<ImportBatchResponse>('/import', body);
  }

  exportUrl(format: ExportFormat): string {
    return `${API_BASE}/export?${toHttpParams({ format }).toString()}`;
  }

  private get<T>(path: string, query?: object, signal?: AbortSignal): Promise<T> {
    return this.send(this.http.get<T>(this.url(path), { params: toHttpParams(query) }), signal);
  }

  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.send(this.http.patch<T>(this.url(path), body));
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.send(this.http.post<T>(this.url(path), body));
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.send(this.http.put<T>(this.url(path), body));
  }

  private async postVoid(path: string, body: unknown): Promise<void> {
    await this.send(this.http.post<unknown>(this.url(path), body));
  }

  private delete<T>(path: string): Promise<T> {
    return this.send(this.http.delete<T>(this.url(path)));
  }

  private async deleteVoid(path: string): Promise<void> {
    await this.send(this.http.delete<unknown>(this.url(path)));
  }

  private url(path: string): string {
    return `${API_BASE}${path}`;
  }

  private async send<T>(request: Observable<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
      return firstValueFrom(request);
    }
    if (signal.aborted) {
      throw abortError();
    }
    try {
      return await firstValueFrom(request.pipe(takeUntil(fromEvent(signal, 'abort'))));
    } catch (error) {
      throw signal.aborted ? abortError() : error;
    }
  }
}

function abortError(): DOMException {
  return new DOMException('The request was aborted', 'AbortError');
}
