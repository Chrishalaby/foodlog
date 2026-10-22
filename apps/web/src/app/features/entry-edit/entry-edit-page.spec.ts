import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  zeroNutrients,
  type EntryDto,
  type FavoriteDto,
  type ProductDto,
  type UpdateEntryRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { ToastService } from '../../core/toast.service';
import { UnsavedWorkService } from '../../core/unsaved-work.service';
import { installDialogShim } from '../../shared/testing/dialog-shim';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { EntryEditPage } from './entry-edit-page';

const COVER = {
  id: 'photo-1',
  url: '/api/photos/photo-1',
  thumbUrl: '/api/photos/photo-1/thumb',
  width: 1024,
  height: 768,
};

const LABEL_PHOTO = {
  id: 'photo-2',
  url: '/api/photos/photo-2',
  thumbUrl: '/api/photos/photo-2/thumb',
  width: 1344,
  height: 1792,
};

const ENTRY: EntryDto = {
  portion: null,
  id: 'entry-1',
  name: 'Salmon plate',
  description: null,
  mealType: 'dinner',
  source: 'food_photo',
  timestamp: new Date(2026, 8, 27, 19, 45).toISOString(),
  localDate: '2026-09-27',
  items: [
    {
      count: null,
      unit: null,
      unitPlural: null,
      id: 'item-1',
      position: 0,
      name: 'Salmon',
      grams: 140,
      nutrients: { ...zeroNutrients(), calories: 290, protein: 28, fat: 19 },
      confidence: 'medium',
      productId: null,
      micros: null,
      fluidMl: null,
    },
  ],
  totals: { ...zeroNutrients(), calories: 290, protein: 28, fat: 19 },
  photo: COVER,
  photos: [{ photo: COVER, role: 'food' }],
  analysisId: 'analysis-1',
  favoriteId: null,
  productId: null,
  createdAt: '2026-09-27T17:45:00.000Z',
  updatedAt: '2026-09-27T17:45:00.000Z',
};

describe('EntryEditPage', () => {
  const api = {
    getEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    getEntryRawAi: vi.fn(),
    renameFood: vi.fn(),
    listProducts: vi.fn(),
    upsertProduct: vi.fn(),
    listFavorites: vi.fn(),
    updateFavorite: vi.fn(),
    createFavoriteFromEntry: vi.fn(),
  };
  const confirm = { confirm: vi.fn<() => Promise<boolean>>() };
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    confirm.confirm.mockReset();
    api.getEntry.mockResolvedValue(ENTRY);
    api.updateEntry.mockImplementation(async (_id: string, body: UpdateEntryRequest) => ({
      ...ENTRY,
      name: body.name,
      mealType: body.mealType,
    }));
    api.deleteEntry.mockResolvedValue(undefined);
    api.renameFood.mockResolvedValue({ matchedEntries: 0, renamedEntries: 0, renamedItems: 0 });
    api.getEntryRawAi.mockResolvedValue({
      entryId: 'entry-1',
      analysisId: 'analysis-1',
      rawAiJson: { mealName: 'Salmon plate' },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => TestBed.inject(ToastService).clear());

  async function render(): Promise<{ fixture: ComponentFixture<EntryEditPage>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(EntryEditPage);
    fixture.componentRef.setInput('id', 'entry-1');
    await fixture.whenStable();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes(text),
    )!;

  it('loads the entry, enables save only after an edit and saves the changes', async () => {
    const { fixture, el } = await render();
    expect(api.getEntry).toHaveBeenCalledWith('entry-1');
    const name = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(name.value).toBe('Salmon plate');
    expect(buttonWith(el, 'No changes').disabled).toBe(true);

    name.value = 'Salmon & greens';
    name.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const save = buttonWith(el, 'Save changes');
    expect(save.disabled).toBe(false);
    save.click();
    await fixture.whenStable();

    expect(api.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({
        name: 'Salmon & greens',
        timestamp: ENTRY.timestamp,
        localDate: '2026-09-27',
        items: [expect.objectContaining({ name: 'Salmon & greens', grams: 140 })],
      }),
    );
    expect(TestBed.inject(ToastService).toasts()[0]?.message).toBe('Changes saved');
    expect(navigate).toHaveBeenCalledWith('/today');
  });

  it('corrects how many were eaten and saves the portion with rescaled items', async () => {
    api.getEntry.mockResolvedValue({
      ...ENTRY,
      name: 'Black Angus burgers',
      portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
      items: [
        {
          ...ENTRY.items[0]!,
          name: 'Black Angus burger',
          grams: 780,
          nutrients: { ...zeroNutrients(), calories: 1450 },
          count: 2,
          unit: 'burger',
          unitPlural: 'burgers',
        },
      ],
    });
    const { fixture, el } = await render();
    const subtitle = () => el.querySelector('header p')?.textContent?.trim() ?? '';
    expect(subtitle()).toContain('2 burgers · 780 g');
    expect(buttonWith(el, 'No changes').disabled).toBe(true);

    el.querySelector<HTMLButtonElement>('button[aria-label="1½ burgers"]')!.click();
    await fixture.whenStable();
    expect(subtitle()).toContain('1½ burgers · 585 g');
    const save = buttonWith(el, 'Save changes');
    expect(save.textContent).toContain('1,088 kcal');
    save.click();
    await fixture.whenStable();

    const body = api.updateEntry.mock.calls[0]![1] as UpdateEntryRequest;
    expect(body.portion).toEqual({ count: 1.5, unit: 'burger', unitPlural: 'burgers' });
    expect(body.items[0]).toMatchObject({ grams: 585, count: 1.5, unit: 'burger' });
  });

  it('shows the meal’s vitamins collapsed and rescales and saves them with the portion', async () => {
    api.getEntry.mockResolvedValue({
      ...ENTRY,
      name: 'Burger meal',
      portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
      items: [
        {
          ...ENTRY.items[0]!,
          name: 'Black Angus burger',
          grams: 780,
          nutrients: { ...zeroNutrients(), calories: 1450 },
          micros: { iron: 6, zinc: 10 },
        },
        {
          ...ENTRY.items[0]!,
          id: 'item-2',
          position: 1,
          name: 'Diet Pepsi',
          grams: 660,
          nutrients: { ...zeroNutrients(), sodium: 80 },
          micros: { caffeine: 72 },
          fluidMl: 660,
        },
      ],
    });
    const { fixture, el } = await render();
    const card = () => el.querySelector('app-micros-card')!;
    const toggle = card().querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.textContent).toContain('Vitamins & minerals');
    expect(toggle.textContent).toContain('Estimated for all 2 foods');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(card().querySelector('app-micros-panel')).toBeNull();

    el.querySelector<HTMLButtonElement>('button[aria-label="1½ burgers"]')!.click();
    await fixture.whenStable();
    toggle.click();
    await fixture.whenStable();
    expect(card().querySelector('[data-micro="iron"]')?.textContent).toContain('4.5 mg');
    expect(card().querySelector('[data-micro="caffeine"]')?.textContent).toContain('54 mg');
    expect(card().querySelector('[data-micro="vitaminC"]')?.textContent).toContain('—');
    expect(card().querySelector('[data-micros-coverage]')?.textContent).toBe(
      'Estimated for all 2 foods',
    );

    buttonWith(el, 'Save changes').click();
    await fixture.whenStable();
    const body = api.updateEntry.mock.calls[0]![1] as UpdateEntryRequest;
    expect(body.items[0]).toMatchObject({ grams: 585, micros: { iron: 4.5, zinc: 7.5 } });
    expect(body.items[1]).toMatchObject({ grams: 495, micros: { caffeine: 54 }, fluidMl: 495 });
  });

  it('hides the vitamins section for an older entry without estimates', async () => {
    const { el } = await render();
    expect(el.querySelector('app-micros-card')).toBeNull();
  });

  describe('an older late-night entry', () => {
    const APPLE: EntryDto = {
      ...ENTRY,
      id: 'entry-1',
      name: 'Red apple',
      mealType: 'snack',
      timestamp: new Date(2026, 9, 2, 0, 56).toISOString(),
      localDate: '2026-10-02',
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 2, 9, 0));
      setDayStartHour(3, null);
      api.getEntry.mockResolvedValue(APPLE);
      api.updateEntry.mockImplementation(async (_id: string, body: UpdateEntryRequest) => ({
        ...APPLE,
        timestamp: body.timestamp,
        localDate: body.localDate,
      }));
    });

    afterEach(() => {
      vi.useRealTimers();
      setDayStartHour(DEFAULT_DAY_START_HOUR, null);
    });

    it('says which day it still counts toward and keeps that day on unrelated edits', async () => {
      const { fixture, el } = await render();
      expect(el.querySelector<HTMLInputElement>('input[type="datetime-local"]')!.value).toBe(
        '2026-10-01T00:56',
      );
      const note = el.querySelector('[data-counted-on]')!;
      expect(note.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Counted on Fri 2 Oct Move to Thu 1 Oct',
      );
      expect(el.textContent).not.toContain('counts toward yesterday');
      expect(buttonWith(el, 'No changes').disabled).toBe(true);

      const name = el.querySelector<HTMLInputElement>('input[type="text"]')!;
      name.value = 'Red apple, large';
      name.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      buttonWith(el, 'Save changes').click();
      await fixture.whenStable();
      const body = api.updateEntry.mock.calls[0]![1] as UpdateEntryRequest;
      expect(body.localDate).toBe('2026-10-02');
      expect(body.timestamp).toBe(APPLE.timestamp);
    });

    it('moves it to the day it was eaten with one tap and keeps the real time', async () => {
      const { fixture, el } = await render();
      buttonWith(el, 'Move to Thu 1 Oct').click();
      await fixture.whenStable();
      expect(el.querySelector('[data-counted-on]')).toBeNull();
      expect(el.querySelector('[data-day-move]')?.textContent?.trim()).toBe(
        'Moves to Thu 1 Oct when you save',
      );

      buttonWith(el, 'Save changes').click();
      await fixture.whenStable();
      const body = api.updateEntry.mock.calls[0]![1] as UpdateEntryRequest;
      expect(body.localDate).toBe('2026-10-01');
      expect(body.timestamp).toBe(APPLE.timestamp);
      await fixture.whenStable();
      expect(el.querySelector('[data-counted-on]')).toBeNull();
      expect(el.querySelector('[data-day-move]')).toBeNull();
      expect(el.textContent).toContain('After midnight (Fri 2 Oct) · counts toward yesterday');
      expect(buttonWith(el, 'No changes').disabled).toBe(true);
    });

    it('drops the note once the time is changed by hand', async () => {
      const { fixture, el } = await render();
      const input = el.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
      input.value = '2026-10-01T23:40';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(el.querySelector('[data-counted-on]')).toBeNull();

      buttonWith(el, 'Save changes').click();
      await fixture.whenStable();
      const body = api.updateEntry.mock.calls[0]![1] as UpdateEntryRequest;
      expect(body.localDate).toBe('2026-10-01');
      expect(body.timestamp).toBe(new Date(2026, 9, 1, 23, 40).toISOString());
    });
  });

  it('shows no day note for an entry whose day matches its time', async () => {
    const { el } = await render();
    expect(el.querySelector('[data-counted-on]')).toBeNull();
  });

  it('adds a portion to an entry that was logged by weight', async () => {
    const { fixture, el } = await render();
    expect(el.querySelector('header p')?.textContent).toContain('140 g');
    buttonWith(el, 'Add portion').click();
    await fixture.whenStable();
    const form = el.querySelector<HTMLFormElement>('form[aria-label="Add a portion"]')!;
    const [count, unit] = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
    count!.value = '1';
    count!.dispatchEvent(new Event('input'));
    unit!.value = 'fillet';
    unit!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    buttonWith(el, 'Save changes').click();
    await fixture.whenStable();
    const body = api.updateEntry.mock.calls[0]![1] as UpdateEntryRequest;
    expect(body.portion).toEqual({ count: 1, unit: 'fillet', unitPlural: 'fillets' });
    expect(body.items[0]).toMatchObject({ grams: 140, count: null });
  });

  it('deletes after confirmation and leaves the page', async () => {
    const { fixture, el } = await render();
    confirm.confirm.mockResolvedValueOnce(false);
    buttonWith(el, 'Delete').click();
    await fixture.whenStable();
    expect(api.deleteEntry).not.toHaveBeenCalled();

    confirm.confirm.mockResolvedValueOnce(true);
    buttonWith(el, 'Delete').click();
    await fixture.whenStable();
    expect(api.deleteEntry).toHaveBeenCalledWith('entry-1');
    expect(navigate).toHaveBeenCalledWith('/today');
  });

  it('lazily loads the AI debug JSON when expanded', async () => {
    const { fixture, el } = await render();
    expect(api.getEntryRawAi).not.toHaveBeenCalled();
    buttonWith(el, 'AI debug').click();
    await fixture.whenStable();
    expect(api.getEntryRawAi).toHaveBeenCalledWith('entry-1');
    expect(el.querySelector('pre')?.textContent).toContain('"mealName": "Salmon plate"');
  });

  it('says a copy from the food library was logged via the food library', async () => {
    api.getEntry.mockResolvedValue({ ...ENTRY, source: 'copy', analysisId: null });
    const { el } = await render();
    expect(el.textContent).toContain('Logged via Food library');
    expect(el.textContent).not.toContain('Logged again');
  });

  it('reports unsaved edits to the app until they are saved', async () => {
    const unsaved = TestBed.inject(UnsavedWorkService);
    const { fixture, el } = await render();
    expect(unsaved.hasUnsavedWork()).toBe(false);

    const name = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    name.value = 'Salmon & greens';
    name.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(unsaved.hasUnsavedWork()).toBe(true);

    buttonWith(el, 'Save changes').click();
    await fixture.whenStable();
    expect(unsaved.hasUnsavedWork()).toBe(false);

    fixture.destroy();
    expect(unsaved.hasUnsavedWork()).toBe(false);
  });

  describe('photos', () => {
    const WITH_LABEL: EntryDto = {
      ...ENTRY,
      photos: [
        { photo: COVER, role: 'food' },
        { photo: LABEL_PHOTO, role: 'label' },
      ],
    };
    let restoreDialog: () => void;

    beforeEach(() => {
      restoreDialog = installDialogShim();
      api.getEntry.mockResolvedValue(WITH_LABEL);
    });

    afterEach(() => restoreDialog());

    const stripLabels = (el: HTMLElement): (string | null)[] =>
      Array.from(el.querySelectorAll('app-photo-strip li button')).map((button) =>
        button.getAttribute('aria-label'),
      );
    const viewer = (el: HTMLElement): HTMLElement => el.querySelector('app-photo-viewer')!;
    const thumb = (el: HTMLElement): string | null | undefined =>
      el.querySelector('app-entry-form button[aria-label="View photo"] img')?.getAttribute('src');

    it('lists every photo under the header and opens the one tapped', async () => {
      const { fixture, el } = await render();
      expect(el.querySelector('app-photo-strip')?.textContent).toContain(
        'Tap to view or change the cover',
      );
      expect(stripLabels(el)).toEqual([
        'View photo 1 of 2, food, cover',
        'View photo 2 of 2, label',
      ]);

      el.querySelector<HTMLButtonElement>('button[aria-label="View photo 2 of 2, label"]')!.click();
      await fixture.whenStable();
      const img = viewer(el).querySelector('img')!;
      expect(viewer(el).querySelector('dialog')?.hasAttribute('open')).toBe(true);
      expect(img.getAttribute('src')).toBe('/api/photos/photo-2');
      expect(img.getAttribute('alt')).toBe('Label photo of Salmon plate');

      viewer(el).querySelector<HTMLButtonElement>('button[aria-label="Previous photo"]')!.click();
      await fixture.whenStable();
      expect(viewer(el).querySelector('img')?.getAttribute('src')).toBe('/api/photos/photo-1');
    });

    it('opens the cover from the thumbnail next to the name', async () => {
      api.getEntry.mockResolvedValue({ ...WITH_LABEL, photo: LABEL_PHOTO });
      const { fixture, el } = await render();
      expect(thumb(el)).toBe('/api/photos/photo-2/thumb');
      el.querySelector<HTMLButtonElement>('button[aria-label="View photo"]')!.click();
      await fixture.whenStable();
      expect(viewer(el).querySelector('img')?.getAttribute('src')).toBe('/api/photos/photo-2');
      expect(buttonWith(viewer(el), 'Cover photo')).toBeDefined();
    });

    it('makes another photo the cover at once and keeps unsaved edits', async () => {
      api.updateEntry.mockImplementationOnce(async () => ({ ...WITH_LABEL, photo: LABEL_PHOTO }));
      const { fixture, el } = await render();
      const events = TestBed.inject(DataEventsService);
      const before = events.entries();
      const name = el.querySelector<HTMLInputElement>('input[type="text"]')!;
      name.value = 'Salmon & greens';
      name.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      el.querySelector<HTMLButtonElement>('button[aria-label="View photo 2 of 2, label"]')!.click();
      await fixture.whenStable();
      buttonWith(viewer(el), 'Set as cover').click();
      await fixture.whenStable();
      await fixture.whenStable();

      expect(api.updateEntry).toHaveBeenCalledTimes(1);
      expect(api.updateEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({
          name: 'Salmon plate',
          timestamp: ENTRY.timestamp,
          localDate: '2026-09-27',
          items: [expect.objectContaining({ name: 'Salmon', grams: 140 })],
          coverPhotoId: 'photo-2',
        }),
      );
      expect(buttonWith(viewer(el), 'Cover photo').getAttribute('aria-disabled')).toBe('true');
      expect(stripLabels(el)).toEqual([
        'View photo 1 of 2, food',
        'View photo 2 of 2, label, cover',
      ]);
      expect(thumb(el)).toBe('/api/photos/photo-2/thumb');
      expect(name.value).toBe('Salmon & greens');
      expect(buttonWith(el, 'Save changes').disabled).toBe(false);
      expect(events.entries()).toBe(before + 1);
      expect(TestBed.inject(ToastService).toasts()[0]?.message).toBe('Cover photo updated');
    });

    it('explains inside the viewer when the cover cannot change', async () => {
      api.updateEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      const { fixture, el } = await render();
      el.querySelector<HTMLButtonElement>('button[aria-label="View photo 2 of 2, label"]')!.click();
      await fixture.whenStable();
      buttonWith(viewer(el), 'Set as cover').click();
      await fixture.whenStable();
      await fixture.whenStable();

      expect(viewer(el).querySelector('[role="alert"]')?.textContent).toBeTruthy();
      expect(buttonWith(viewer(el), 'Set as cover')).toBeDefined();
      expect(stripLabels(el)[0]).toBe('View photo 1 of 2, food, cover');

      viewer(el).querySelector<HTMLButtonElement>('button[aria-label="Previous photo"]')!.click();
      await fixture.whenStable();
      expect(viewer(el).querySelector('[role="alert"]')).toBeNull();
    });

    it('keeps a single photo in the header thumbnail only', async () => {
      api.getEntry.mockResolvedValue(ENTRY);
      const { fixture, el } = await render();
      expect(el.querySelector('app-photo-strip')).toBeNull();
      el.querySelector<HTMLButtonElement>('button[aria-label="View photo"]')!.click();
      await fixture.whenStable();
      expect(viewer(el).querySelector('img')?.getAttribute('alt')).toBe(
        'Food photo of Salmon plate',
      );
      expect(buttonWith(viewer(el), 'Set as cover')).toBeUndefined();
    });
  });

  describe('saving as a favorite under another name', () => {
    let restoreDialog: () => void;

    beforeEach(() => {
      restoreDialog = installDialogShim();
      api.createFavoriteFromEntry.mockImplementation(
        async (_id: string, body: { name?: string }): Promise<FavoriteDto> => ({
          portion: null,
          id: 'fav-9',
          name: body.name ?? ENTRY.name,
          mealType: null,
          items: ENTRY.items,
          totals: ENTRY.totals,
          photo: ENTRY.photo,
          useCount: 0,
          lastUsedAt: null,
          createdAt: ENTRY.createdAt,
          updatedAt: ENTRY.updatedAt,
        }),
      );
    });

    afterEach(() => restoreDialog());

    async function saveFavoriteAs(name: string): Promise<void> {
      const { fixture, el } = await render();
      buttonWith(el, 'Favorite').click();
      await fixture.whenStable();
      const input = el.querySelector<HTMLInputElement>('#entry-edit-favorite-name')!;
      input.value = name;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();
      await fixture.whenStable();
    }

    it('offers to rename past entries to the favorite name', async () => {
      api.renameFood
        .mockResolvedValueOnce({ matchedEntries: 3, renamedEntries: 0, renamedItems: 0 })
        .mockResolvedValueOnce({ matchedEntries: 3, renamedEntries: 3, renamedItems: 1 });
      confirm.confirm.mockResolvedValueOnce(true);

      await saveFavoriteAs('Grilled salmon');

      expect(api.createFavoriteFromEntry).toHaveBeenCalledWith('entry-1', {
        name: 'Grilled salmon',
      });
      expect(api.renameFood).toHaveBeenNthCalledWith(1, {
        from: 'Salmon plate',
        to: 'Grilled salmon',
        dryRun: true,
      });
      expect(confirm.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Also rename past entries?' }),
      );
      expect(api.renameFood).toHaveBeenNthCalledWith(2, {
        from: 'Salmon plate',
        to: 'Grilled salmon',
      });
    });

    it('does not offer a rename when the favorite keeps the entry name', async () => {
      await saveFavoriteAs('');
      expect(api.createFavoriteFromEntry).toHaveBeenCalledWith('entry-1', {});
      expect(api.renameFood).not.toHaveBeenCalled();
      expect(confirm.confirm).not.toHaveBeenCalled();
    });
  });

  it('shows a not-found state for unknown entries', async () => {
    api.getEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    const { el } = await render();
    expect(el.textContent).toContain('Entry not found');
  });

  describe('renaming other entries with the old name', () => {
    async function renameAndSave(name: string): Promise<ComponentFixture<EntryEditPage>> {
      const { fixture, el } = await render();
      const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
      input.value = name;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      buttonWith(el, 'Save changes').click();
      await fixture.whenStable();
      await fixture.whenStable();
      return fixture;
    }

    const toastMessages = (): string[] =>
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.message);

    it('offers to rename the others after saving a new name and applies it', async () => {
      api.renameFood
        .mockResolvedValueOnce({ matchedEntries: 2, renamedEntries: 0, renamedItems: 0 })
        .mockResolvedValueOnce({ matchedEntries: 2, renamedEntries: 2, renamedItems: 1 });
      confirm.confirm.mockResolvedValueOnce(true);
      const events = TestBed.inject(DataEventsService);
      const before = events.entries();

      await renameAndSave('Salmon & greens');

      expect(api.renameFood).toHaveBeenNthCalledWith(1, {
        from: 'Salmon plate',
        to: 'Salmon & greens',
        dryRun: true,
      });
      expect(confirm.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Also rename 2 other “Salmon plate” entries to “Salmon & greens”?',
          confirmLabel: 'Rename all',
        }),
      );
      expect(api.renameFood).toHaveBeenNthCalledWith(2, {
        from: 'Salmon plate',
        to: 'Salmon & greens',
      });
      expect(events.entries()).toBe(before + 2);
      expect(toastMessages()).toContain('Renamed 2 other entries to “Salmon & greens”');
      expect(navigate).toHaveBeenCalledWith('/today');
    });

    it('keeps the other entries when the offer is declined', async () => {
      api.renameFood.mockResolvedValueOnce({
        matchedEntries: 1,
        renamedEntries: 0,
        renamedItems: 0,
      });
      confirm.confirm.mockResolvedValueOnce(false);
      await renameAndSave('Salmon & greens');
      expect(confirm.confirm).toHaveBeenCalledTimes(1);
      expect(api.renameFood).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/today');
    });

    it('skips the question when no other entry carries the old name', async () => {
      await renameAndSave('Salmon & greens');
      expect(api.renameFood).toHaveBeenCalledTimes(1);
      expect(confirm.confirm).not.toHaveBeenCalled();
      expect(toastMessages()).toEqual(['Changes saved']);
      expect(navigate).toHaveBeenCalledWith('/today');
    });

    it('does not look for other entries when the name did not change', async () => {
      const { fixture, el } = await render();
      const description = el.querySelector<HTMLTextAreaElement>('#entry-edit-description')!;
      description.value = 'Wild salmon';
      description.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      buttonWith(el, 'Save changes').click();
      await fixture.whenStable();
      expect(api.updateEntry).toHaveBeenCalled();
      expect(api.renameFood).not.toHaveBeenCalled();
    });

    it('reports a failed rename but still leaves the saved entry', async () => {
      api.renameFood
        .mockResolvedValueOnce({ matchedEntries: 2, renamedEntries: 0, renamedItems: 0 })
        .mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      confirm.confirm.mockResolvedValueOnce(true);
      await renameAndSave('Salmon & greens');
      expect(toastMessages()).toContain("Couldn't rename the other entries. Please try again.");
      expect(navigate).toHaveBeenCalledWith('/today');
    });
  });

  describe('renaming what the entry was logged from', () => {
    const PRODUCT: ProductDto = {
      id: 'product-1',
      barcode: '5281234567896',
      name: 'Salmon plate',
      brand: null,
      aliases: [],
      unitName: null,
      unitGrams: null,
      basisUnit: 'g',
      per100: { ...zeroNutrients(), calories: 207, protein: 20, fat: 13.6 },
      microsPer100: null,
      servingSizeG: 140,
      packSizeG: null,
      source: 'label',
      imageUrl: null,
      missingNutrients: [],
      useCount: 2,
      lastUsedAt: null,
    };
    const FAVORITE: FavoriteDto = {
      portion: null,
      id: 'fav-1',
      name: 'Salmon plate',
      mealType: 'dinner',
      items: [{ name: 'Salmon', grams: 140, nutrients: ENTRY.totals }],
      totals: ENTRY.totals,
      photo: null,
      useCount: 2,
      lastUsedAt: null,
      createdAt: ENTRY.createdAt,
      updatedAt: ENTRY.updatedAt,
    };

    async function renameTo(name: string): Promise<void> {
      const { fixture, el } = await render();
      const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
      input.value = name;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      buttonWith(el, 'Save changes').click();
      await fixture.whenStable();
      await fixture.whenStable();
      await fixture.whenStable();
    }

    beforeEach(() => {
      const linked: EntryDto = {
        ...ENTRY,
        source: 'barcode',
        productId: 'product-1',
        favoriteId: 'fav-1',
      };
      api.getEntry.mockResolvedValue(linked);
      api.updateEntry.mockImplementation(async (_id: string, body: UpdateEntryRequest) => ({
        ...linked,
        name: body.name,
        mealType: body.mealType,
      }));
      api.listProducts.mockResolvedValue([PRODUCT]);
      api.upsertProduct.mockImplementation(async (_code: string, body: object) => ({
        ...PRODUCT,
        ...body,
      }));
      api.listFavorites.mockResolvedValue([FAVORITE]);
      api.updateFavorite.mockImplementation(async (_id: string, body: object) => ({
        ...FAVORITE,
        ...body,
      }));
    });

    it('renames the product too when no other entry carries the old name', async () => {
      await renameTo('Salmon & greens');
      expect(confirm.confirm).not.toHaveBeenCalled();
      expect(api.upsertProduct).toHaveBeenCalledWith(
        '5281234567896',
        expect.objectContaining({ name: 'Salmon & greens', brand: null, source: 'label' }),
      );
      expect(api.updateFavorite).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/today');
    });

    it('renames the product and the favorite after "Rename all"', async () => {
      api.renameFood
        .mockResolvedValueOnce({ matchedEntries: 2, renamedEntries: 0, renamedItems: 0 })
        .mockResolvedValueOnce({ matchedEntries: 2, renamedEntries: 2, renamedItems: 2 });
      confirm.confirm.mockResolvedValueOnce(true);
      await renameTo('Salmon & greens');
      expect(api.renameFood).toHaveBeenCalledTimes(2);
      expect(api.upsertProduct.mock.invocationCallOrder[0]).toBeGreaterThan(
        api.renameFood.mock.invocationCallOrder[1]!,
      );
      expect(api.upsertProduct.mock.calls[0]![1]).toMatchObject({ name: 'Salmon & greens' });
      expect(api.updateFavorite).toHaveBeenCalledWith('fav-1', {
        name: 'Salmon & greens',
        mealType: 'dinner',
        items: FAVORITE.items,
        portion: null,
      });
      expect(navigate).toHaveBeenCalledWith('/today');
    });

    it('keeps the product and the favorite for "Just this one"', async () => {
      api.renameFood.mockResolvedValueOnce({
        matchedEntries: 1,
        renamedEntries: 0,
        renamedItems: 0,
      });
      confirm.confirm.mockResolvedValueOnce(false);
      await renameTo('Salmon & greens');
      expect(api.listProducts).not.toHaveBeenCalled();
      expect(api.upsertProduct).not.toHaveBeenCalled();
      expect(api.updateFavorite).not.toHaveBeenCalled();
    });

    it('reports a failed product rename and still leaves the page', async () => {
      api.upsertProduct.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      await renameTo('Salmon & greens');
      const messages = TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.message);
      expect(messages).toContain("Couldn't rename the product too. Please try again.");
      expect(navigate).toHaveBeenCalledWith('/today');
    });
  });
});
