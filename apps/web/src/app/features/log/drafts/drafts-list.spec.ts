import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { zeroNutrients, type DraftDto, type UserDto } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { NetworkService } from '../../../core/network.service';
import {
  OFFLINE_DRAFTS_BACKEND,
  OfflineDraftsStore,
  memoryDraftsBackend,
} from '../../../core/offline-drafts.store';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService } from '../../../shared/ui/confirm.service';
import { installDialogShim } from '../testing/dialog-shim';
import { DraftSyncService } from '../../../core/draft-sync.service';
import { DRAFT_DELETED_MESSAGE, DRAFT_UPLOADING_MESSAGE } from './draft-actions';
import { DraftResumeHandoff } from './draft-resume';
import { DraftsList } from './drafts-list';
import { DraftsStore } from './drafts.store';

const ALICE: UserDto = { id: 'user-alice', email: 'a@example.com', name: 'Alice', role: 'member' };

function draft(id: string, overrides: Partial<DraftDto> = {}): DraftDto {
  return {
    portion: null,
    id,
    mode: 'food_photo',
    name: null,
    description: `Meal ${id}`,
    mealType: 'lunch',
    timestamp: new Date().toISOString(),
    localDate: '2026-09-30',
    items: null,
    analysisId: null,
    photos: [
      {
        role: 'food',
        photo: {
          id: `${id}-p`,
          url: `/api/photos/${id}-p`,
          thumbUrl: `/api/photos/${id}-p/thumb`,
          width: 1,
          height: 1,
        },
      },
    ],
    createdAt: '2026-09-30T08:00:00.000Z',
    updatedAt: `2026-09-30T08:0${id.length}:00.000Z`,
    ...overrides,
  };
}

const SOUP = draft('soup', { updatedAt: '2026-09-30T09:00:00.000Z' });
const BOWL = draft('bowl', {
  updatedAt: '2026-09-30T08:00:00.000Z',
  name: 'Poke bowl',
  analysisId: 'a-1',
  items: [{ name: 'Poke', grams: 350, nutrients: { ...zeroNutrients(), calories: 540 } }],
});
const TOAST = draft('toast', { updatedAt: '2026-09-29T08:00:00.000Z', photos: [] });

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const buttonWith = (root: ParentNode, text: string): HTMLButtonElement | undefined =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  );

describe('DraftsList', () => {
  const api = {
    listDrafts: vi.fn<() => Promise<DraftDto[]>>(),
    deleteDraft: vi.fn<(id: string) => Promise<void>>(),
    createDraft: vi.fn(),
  };
  const confirm = { confirm: vi.fn<() => Promise<boolean>>() };
  let restoreDialog: () => void;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    api.listDrafts.mockReset().mockResolvedValue([SOUP, BOWL, TOAST]);
    api.deleteDraft.mockReset().mockResolvedValue(undefined);
    confirm.confirm.mockReset().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: confirm },
        { provide: AuthService, useValue: { user: signal<UserDto | null>(ALICE) } },
        { provide: NetworkService, useValue: { online: signal(false) } },
        { provide: OFFLINE_DRAFTS_BACKEND, useFactory: memoryDraftsBackend },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  async function render(
    variant: 'card' | 'section' = 'section',
    limit: number | null = null,
  ): Promise<{ fixture: ComponentFixture<DraftsList>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(DraftsList);
    fixture.componentRef.setInput('variant', variant);
    fixture.componentRef.setInput('limit', limit);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function rows(el: HTMLElement): string[] {
    return Array.from(
      el.querySelectorAll<HTMLButtonElement>('button[aria-label^="Open draft"]'),
    ).map((button) => button.getAttribute('aria-label') ?? '');
  }

  it('lists drafts with their photo, time and whether they were analysed', async () => {
    const { el } = await render();

    expect(el.querySelector('h2')?.textContent).toContain('Drafts');
    expect(el.querySelector('h2')?.textContent).toContain('3');
    const labels = rows(el);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toContain('Meal soup');
    expect(labels[0]).toContain('Not analysed');
    expect(labels[1]).toContain('Poke bowl');
    expect(labels[1]).toContain('Analysed · 350 g · 540 kcal');
    const thumb = el.querySelector<HTMLImageElement>('li img');
    expect(thumb?.getAttribute('src')).toBe('/api/photos/soup-p/thumb');
  });

  it('shows nothing at all when there are no drafts', async () => {
    api.listDrafts.mockResolvedValue([]);
    const { el } = await render('card');
    expect(el.querySelector('section')).toBeNull();
  });

  it('keeps the Today card compact with a link to every draft', async () => {
    const { el } = await render('card', 2);
    expect(rows(el)).toHaveLength(2);
    const seeAll = el.querySelector<HTMLAnchorElement>('a[href^="/log"]');
    expect(seeAll?.textContent).toContain('See all');
    expect(seeAll?.getAttribute('href')).toBe('/log?drafts=1');
  });

  it('opens a draft on the log screen with one tap', async () => {
    const { el } = await render();
    el.querySelector<HTMLButtonElement>('button[aria-label^="Open draft"]')!.click();

    const request = TestBed.inject(DraftResumeHandoff).pending();
    expect(request?.source).toEqual({ kind: 'server', draft: SOUP });
    expect(request?.analyze).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/log');
  });

  it('offers to analyze a draft right away from its menu', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label^="More options for draft Meal soup"]',
    )!.click();
    await fixture.whenStable();

    const sheet = el.querySelector('dialog')!;
    expect(sheet.hasAttribute('open')).toBe(true);
    expect(buttonWith(sheet, 'Review & log')).toBeUndefined();
    buttonWith(sheet, 'Analyze now')!.click();
    await fixture.whenStable();

    expect(TestBed.inject(DraftResumeHandoff).pending()?.analyze).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/log');
  });

  it('offers review instead of analysis for an analysed draft', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label^="More options for draft Poke bowl"]',
    )!.click();
    await fixture.whenStable();
    const sheet = el.querySelector('dialog')!;
    expect(buttonWith(sheet, 'Analyze now')).toBeUndefined();
    expect(buttonWith(sheet, 'Review & log')).toBeDefined();
  });

  it('deletes a draft after confirming', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label^="More options for draft Meal soup"]',
    )!.click();
    await fixture.whenStable();
    buttonWith(el.querySelector('dialog')!, 'Delete draft')!.click();
    await flush();
    await fixture.whenStable();

    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete this draft?', tone: 'danger' }),
    );
    expect(api.deleteDraft).toHaveBeenCalledWith('soup');
    expect(rows(el)).toHaveLength(2);
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.message),
    ).toContain(DRAFT_DELETED_MESSAGE);
  });

  it('keeps the draft when the delete is cancelled', async () => {
    confirm.confirm.mockResolvedValue(false);
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label^="More options for draft Meal soup"]',
    )!.click();
    await fixture.whenStable();
    buttonWith(el.querySelector('dialog')!, 'Delete draft')!.click();
    await flush();
    expect(api.deleteDraft).not.toHaveBeenCalled();
    expect(rows(el)).toHaveLength(3);
  });

  it('closes the options when the draft disappears meanwhile', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label^="More options for draft Meal soup"]',
    )!.click();
    await fixture.whenStable();
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(true);

    TestBed.inject(DraftsStore).forget('soup');
    await fixture.whenStable();

    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('does not delete a draft while it is uploading', async () => {
    api.listDrafts.mockResolvedValue([]);
    await TestBed.inject(OfflineDraftsStore).add({
      fields: {
        mode: 'text',
        description: 'Manakish',
        timestamp: new Date().toISOString(),
        localDate: '2026-09-30',
      },
      images: [],
    });
    const { fixture, el } = await render();
    vi.spyOn(TestBed.inject(DraftSyncService), 'isUploading').mockReturnValue(true);
    el.querySelector<HTMLButtonElement>('button[aria-label^="More options for draft"]')!.click();
    await fixture.whenStable();
    buttonWith(el.querySelector('dialog')!, 'Delete draft')!.click();
    await flush();

    expect(confirm.confirm).not.toHaveBeenCalled();
    expect(TestBed.inject(OfflineDraftsStore).drafts()).toHaveLength(1);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(DRAFT_UPLOADING_MESSAGE);
  });

  it('marks drafts that are waiting on this phone to upload', async () => {
    api.listDrafts.mockResolvedValue([]);
    await TestBed.inject(OfflineDraftsStore).add({
      fields: {
        mode: 'text',
        description: 'Manakish',
        timestamp: new Date().toISOString(),
        localDate: '2026-09-30',
      },
      images: [],
    });
    const { el } = await render();
    expect(rows(el)[0]).toContain('Manakish');
    expect(rows(el)[0]).toContain('Waiting to upload');
  });
});
