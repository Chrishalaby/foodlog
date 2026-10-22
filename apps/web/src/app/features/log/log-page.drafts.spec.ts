import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  zeroNutrients,
  type AnalyzeResponse,
  type CreateDraftFields,
  type DraftDto,
  type EntryDto,
  type UserDto,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CaptureService } from '../../core/capture.service';
import { NetworkService } from '../../core/network.service';
import { OFFLINE_DRAFTS_BACKEND, memoryDraftsBackend } from '../../core/offline-drafts.store';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import type { CompressedImage } from '../../shared/utils/image-compress';
import { DraftResumeHandoff } from './drafts/draft-resume';
import {
  DRAFT_SAVED_MESSAGE,
  DRAFT_SAVED_OFFLINE,
  DRAFT_SAVED_UNREACHABLE,
  DRAFT_UPDATED_MESSAGE,
  LogPage,
} from './log-page';
import { IMAGE_COMPRESSOR, PHOTO_TIME_READER } from './log.store';
import { installDialogShim } from './testing/dialog-shim';

const ALICE: UserDto = { id: 'user-alice', email: 'a@example.com', name: 'Alice', role: 'member' };

const PHOTO = {
  id: 'photo-1',
  url: '/api/photos/photo-1',
  thumbUrl: '/api/photos/photo-1/thumb',
  width: 1200,
  height: 1600,
};

const DRAFT: DraftDto = {
  portion: null,
  id: 'draft-1',
  mode: 'food_photo',
  name: null,
  description: 'Fattoush and grilled halloumi',
  mealType: 'lunch',
  timestamp: new Date(2026, 8, 30, 12, 45).toISOString(),
  localDate: '2026-09-30',
  items: null,
  analysisId: null,
  photos: [{ photo: PHOTO, role: 'food' }],
  createdAt: '2026-09-30T09:50:00.000Z',
  updatedAt: '2026-09-30T09:50:00.000Z',
};

const ANALYSIS: AnalyzeResponse = {
  analysisId: 'analysis-5',
  mode: 'food_photo',
  description: 'Fattoush and grilled halloumi',
  result: {
    inputType: 'food_photo',
    mealName: 'Fattoush with halloumi',
    portion: null,
    scaleCues: '',
    items: [
      {
        count: null,
        unit: null,
        unitPlural: null,
        name: 'Fattoush',
        grams: 250,
        nutrients: { ...zeroNutrients(), calories: 310 },
        per100g: { ...zeroNutrients(), calories: 124 },
        micros: null,
        microsPer100g: null,
        fluidMl: null,
        confidence: 'medium',
        amountSource: 'visual_estimate',
        state: 'as_served',
        portionBasis: 'One bowl',
        flags: [],
        savedFood: null,
        suggestedFood: null,
      },
    ],
    label: null,
    totals: zeroNutrients(),
    assumptions: [],
    followUpQuestion: null,
    followUpOptions: [],
    warnings: [],
  },
  photo: PHOTO,
  photos: [{ photo: PHOTO, role: 'food' }],
  usage: {
    model: 'mock',
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    durationMs: 700,
    attempts: 1,
  },
  precise: false,
};

const buttonWith = (el: ParentNode, text: string): HTMLButtonElement | undefined =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  );

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function compressed(blob: Blob): CompressedImage {
  return {
    blob,
    mimeType: 'image/jpeg',
    width: 1,
    height: 1,
    sourceWidth: 1,
    sourceHeight: 1,
    sourceBytes: 1,
    bytes: 1,
    decoder: 'image-bitmap',
  };
}

describe('LogPage drafts', () => {
  const api = {
    analyze: vi.fn(),
    createEntry: vi.fn(),
    createFavoriteFromEntry: vi.fn(),
    searchFoods: vi.fn(),
    getProfile: vi.fn(),
    listDrafts: vi.fn<() => Promise<DraftDto[]>>(),
    createDraft: vi.fn<(fields: CreateDraftFields) => Promise<DraftDto>>(),
    updateDraft: vi.fn(),
    logDraft: vi.fn(),
    deleteDraft: vi.fn(),
    updateEntry: vi.fn(),
  };
  const confirm = { confirm: vi.fn<() => Promise<boolean>>() };
  let online: ReturnType<typeof signal<boolean>>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let restoreDialog: () => void;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    Object.values(api).forEach((mock) => mock.mockReset());
    confirm.confirm.mockReset().mockResolvedValue(true);
    api.searchFoods.mockResolvedValue({ query: '', results: [] });
    api.getProfile.mockRejectedValue(new Error('offline'));
    api.listDrafts.mockResolvedValue([]);
    api.analyze.mockResolvedValue(ANALYSIS);
    api.createDraft.mockImplementation(async (fields) => ({
      ...DRAFT,
      id: 'draft-new',
      description: fields.description ?? null,
    }));
    api.updateDraft.mockImplementation(async (id: string) => ({ ...DRAFT, id }));
    api.logDraft.mockImplementation(async (id: string): Promise<EntryDto> => ({
      portion: null,
      id: `entry-${id}`,
      name: 'Fattoush with halloumi',
      description: null,
      mealType: 'lunch',
      source: 'food_photo',
      timestamp: DRAFT.timestamp,
      localDate: DRAFT.localDate,
      items: [],
      totals: zeroNutrients(),
      photo: PHOTO,
      photos: DRAFT.photos,
      analysisId: 'analysis-5',
      favoriteId: null,
      productId: null,
      createdAt: DRAFT.createdAt,
      updatedAt: DRAFT.updatedAt,
    }));
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    online = signal(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: confirm },
        {
          provide: AuthService,
          useValue: { user: signal<UserDto | null>(ALICE), isAdmin: signal(false) },
        },
        { provide: NetworkService, useValue: { online } },
        { provide: OFFLINE_DRAFTS_BACKEND, useFactory: memoryDraftsBackend },
        {
          provide: IMAGE_COMPRESSOR,
          useValue: async () => compressed(new Blob(['jpeg'], { type: 'image/jpeg' })),
        },
        { provide: PHOTO_TIME_READER, useValue: async () => null },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    restoreDialog();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  async function render(): Promise<{ fixture: ComponentFixture<LogPage>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(LogPage);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function lastToast() {
    return TestBed.inject(ToastService).toasts().at(-1);
  }

  async function captureMeal(fixture: ComponentFixture<LogPage>): Promise<void> {
    const camera = document.createElement('input');
    const library = document.createElement('input');
    const detach = TestBed.inject(CaptureService).attachInputs({ camera, library });
    camera.click = () => undefined;
    TestBed.inject(CaptureService).requestCamera('food_photo');
    Object.defineProperty(camera, 'files', {
      configurable: true,
      value: [new File(['raw'], 'plate.jpg', { type: 'image/jpeg' })],
    });
    Object.defineProperty(camera.files, 'item', {
      value: (index: number) => (camera.files as unknown as File[])[index] ?? null,
    });
    camera.dispatchEvent(new Event('change'));
    detach();
    await fixture.whenStable();
    await fixture.whenStable();
  }

  it('saves a photo for later from the compose step and goes back to Today', async () => {
    const { fixture, el } = await render();
    await captureMeal(fixture);
    expect(el.querySelector('h1')?.textContent).toContain('Food photo');

    const later = buttonWith(el, 'Save for later');
    expect(later?.disabled).toBe(false);
    later!.click();
    await flush();
    await fixture.whenStable();

    expect(api.createDraft).toHaveBeenCalledTimes(1);
    expect(api.analyze).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/today');
    const toast = lastToast();
    expect(toast?.message).toBe(DRAFT_SAVED_MESSAGE);
    expect(toast?.action?.label).toBe('View');
    toast?.action?.run();
    expect(navigate).toHaveBeenCalledWith('/log?drafts=1');
  });

  it('tells the user a draft stayed on the phone while offline', async () => {
    online.set(false);
    const { fixture, el } = await render();
    buttonWith(el, 'Describe')!.click();
    await fixture.whenStable();
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Manakish with zaatar';
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    buttonWith(el, 'Save for later')!.click();
    await flush();
    await fixture.whenStable();

    expect(api.createDraft).not.toHaveBeenCalled();
    expect(lastToast()?.message).toBe(DRAFT_SAVED_OFFLINE);
    expect(lastToast()?.kind).toBe('info');
    expect(navigate).toHaveBeenCalledWith('/today');
  });

  it('keeps the draft on the phone when the server is briefly unavailable', async () => {
    api.createDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
    const { fixture, el } = await render();
    await captureMeal(fixture);

    buttonWith(el, 'Save for later')!.click();
    await flush();
    await fixture.whenStable();

    expect(lastToast()?.message).toBe(DRAFT_SAVED_UNREACHABLE);
    expect(navigate).toHaveBeenCalledWith('/today');
  });

  it('asks before a new photo replaces an edited draft and starts clean', async () => {
    TestBed.inject(DraftResumeHandoff).offer({ kind: 'server', draft: DRAFT });
    const { fixture, el } = await render();
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Fattoush only';
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    confirm.confirm.mockResolvedValueOnce(false);

    await captureMeal(fixture);
    await flush();
    await fixture.whenStable();

    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Leave this draft?' }),
    );
    expect(el.textContent).toContain('From your drafts');

    await captureMeal(fixture);
    await flush();
    await fixture.whenStable();

    expect(el.textContent).not.toContain('From your drafts');
    expect(el.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '').toBe('');
  });

  it('offers to save for later right in the offline message', async () => {
    online.set(false);
    const { fixture, el } = await render();
    buttonWith(el, 'Describe')!.click();
    await fixture.whenStable();
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Lentil soup, one bowl';
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    buttonWith(el, 'Analyze')!.click();
    await flush();
    await fixture.whenStable();

    const card = el.querySelector('app-error-card')!;
    expect(card.textContent).toContain('offline');
    buttonWith(card, 'Save for later')!.click();
    await flush();
    await fixture.whenStable();

    expect(api.analyze).not.toHaveBeenCalled();
    expect(lastToast()?.message).toBe(DRAFT_SAVED_OFFLINE);
  });

  it('offers save as draft after the analysis', async () => {
    const { fixture, el } = await render();
    buttonWith(el, 'Describe')!.click();
    await fixture.whenStable();
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'fattoush';
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    buttonWith(el, 'Analyze')!.click();
    await flush();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');

    buttonWith(el, 'Save as draft')!.click();
    await flush();
    await fixture.whenStable();

    const [fields] = api.createDraft.mock.calls[0]!;
    expect(fields).toMatchObject({ analysisId: 'analysis-5', name: 'Fattoush with halloumi' });
    expect(fields.items).toContain('Fattoush');
    expect(lastToast()?.message).toBe(DRAFT_SAVED_MESSAGE);
    expect(navigate).toHaveBeenCalledWith('/today');
  });

  it('resumes a draft handed over from Today and analyzes it without re-uploading photos', async () => {
    TestBed.inject(DraftResumeHandoff).offer({ kind: 'server', draft: DRAFT });
    const { fixture, el } = await render();

    expect(el.textContent).toContain('From your drafts');
    expect(el.querySelector<HTMLImageElement>('img[alt="Photo 1, food"]')?.src).toContain(
      '/api/photos/photo-1',
    );
    expect(el.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
      'Fattoush and grilled halloumi',
    );
    expect(el.textContent).toContain('Meal time');
    expect(buttonWith(el, 'Update draft')).toBeDefined();

    buttonWith(el, 'Analyze')!.click();
    await flush();
    await fixture.whenStable();

    expect(api.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'draft-1', mode: 'food_photo' }),
      [],
    );
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(el.textContent).toContain('Draft');

    buttonWith(el, 'Save to log')!.click();
    await flush();
    await fixture.whenStable();
    expect(api.logDraft).toHaveBeenCalledWith('draft-1', expect.any(Object));
    expect(api.createEntry).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/today');
  });

  it('logs a draft with the cover picked and warns when the cover cannot be applied', async () => {
    const label = {
      ...PHOTO,
      id: 'photo-2',
      url: '/api/photos/photo-2',
      thumbUrl: '/api/photos/photo-2/thumb',
    };
    const photos: DraftDto['photos'] = [
      { photo: PHOTO, role: 'food' },
      { photo: label, role: 'label' },
    ];
    const draft: DraftDto = {
      ...DRAFT,
      name: 'Fattoush',
      analysisId: 'analysis-5',
      items: [{ name: 'Fattoush', grams: 250, nutrients: { ...zeroNutrients(), calories: 310 } }],
      photos,
    };
    api.logDraft.mockResolvedValueOnce({
      id: 'entry-draft-1',
      name: 'Fattoush',
      description: null,
      mealType: 'lunch',
      source: 'food_photo',
      timestamp: DRAFT.timestamp,
      localDate: DRAFT.localDate,
      items: [],
      totals: zeroNutrients(),
      portion: null,
      photo: PHOTO,
      photos,
      analysisId: 'analysis-5',
      favoriteId: null,
      productId: null,
      createdAt: DRAFT.createdAt,
      updatedAt: DRAFT.updatedAt,
    } satisfies EntryDto);
    api.updateEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
    TestBed.inject(DraftResumeHandoff).offer({ kind: 'server', draft });
    const { fixture, el } = await render();

    el.querySelector<HTMLButtonElement>('button[aria-label="View photo 2 of 2, label"]')!.click();
    await fixture.whenStable();
    const viewer = el.querySelector<HTMLElement>('app-photo-viewer')!;
    buttonWith(viewer, 'Set as cover')!.click();
    await fixture.whenStable();
    viewer.querySelector<HTMLButtonElement>('button[aria-label="Close photo"]')!.click();
    await fixture.whenStable();

    buttonWith(el, 'Save to log')!.click();
    await flush();
    await fixture.whenStable();

    expect(api.logDraft).toHaveBeenCalledWith('draft-1', expect.any(Object));
    expect(api.updateEntry).toHaveBeenCalledWith(
      'entry-draft-1',
      expect.objectContaining({ coverPhotoId: 'photo-2' }),
    );
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map(({ message }) => message),
    ).toContain("The meal was saved, but the cover photo couldn't be changed.");
    expect(navigate).toHaveBeenCalledWith('/today');
  });

  it('analyzes straight away when asked from the drafts menu', async () => {
    TestBed.inject(DraftResumeHandoff).offer({ kind: 'server', draft: DRAFT }, true);
    await render();
    await flush();
    expect(api.analyze).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'draft-1' }), []);
  });

  it('opens a draft from the list on the log screen', async () => {
    api.listDrafts.mockResolvedValue([DRAFT]);
    const { fixture, el } = await render();
    const row = el.querySelector<HTMLButtonElement>('button[aria-label^="Open draft"]');
    expect(row?.getAttribute('aria-label')).toContain('Fattoush and grilled halloumi');

    row!.click();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(el.textContent).toContain('From your drafts');
    expect(TestBed.inject(DraftResumeHandoff).pending()).toBeNull();
  });

  it('closes an untouched draft without asking and asks before dropping edits', async () => {
    TestBed.inject(DraftResumeHandoff).offer({ kind: 'server', draft: DRAFT });
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    await fixture.whenStable();
    expect(confirm.confirm).not.toHaveBeenCalled();
    expect(el.querySelector('h1')?.textContent).toContain('Log food');

    TestBed.inject(DraftResumeHandoff).offer({ kind: 'server', draft: DRAFT });
    await fixture.whenStable();
    await fixture.whenStable();
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Fattoush only';
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    confirm.confirm.mockResolvedValueOnce(false);
    el.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    await flush();
    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Leave this draft?' }),
    );
    expect(el.textContent).toContain('From your drafts');
  });

  it('updates the resumed draft instead of creating a new one', async () => {
    TestBed.inject(DraftResumeHandoff).offer({ kind: 'server', draft: DRAFT });
    const { fixture, el } = await render();
    expect(buttonWith(el, 'Update draft')?.disabled).toBe(true);
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Fattoush, no halloumi';
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    buttonWith(el, 'Update draft')!.click();
    await flush();
    await fixture.whenStable();

    expect(api.updateDraft).toHaveBeenCalledWith('draft-1', expect.any(Object));
    expect(api.createDraft).not.toHaveBeenCalled();
    expect(lastToast()?.message).toBe(DRAFT_UPDATED_MESSAGE);
  });
});
