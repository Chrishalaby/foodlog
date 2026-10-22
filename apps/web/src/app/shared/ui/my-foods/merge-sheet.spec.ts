import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { FoodMergeSuggestion, MergeFoodsRequest, MyFoodChangeResponse } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { ToastService } from '../../../core/toast.service';
import { installDialogShim } from '../../testing/dialog-shim';
import {
  bunSuggestion,
  ketchupSuggestion,
  mergeVariant,
  myFood,
  per100,
} from '../../testing/my-foods-fixtures';
import { MergeSheet, NAME_KEPT_APART } from './merge-sheet';

@Component({
  imports: [MergeSheet],
  template: `<app-merge-sheet
    [(open)]="open"
    [suggestion]="suggestion()"
    (merged)="merged.set($event)"
  />`,
})
class Host {
  readonly open = signal(true);
  readonly suggestion = signal<FoodMergeSuggestion | null>(ketchupSuggestion());
  readonly merged = signal<MyFoodChangeResponse | null>(null);
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('MergeSheet', () => {
  const api = {
    mergeFoods: vi.fn<(body: MergeFoodsRequest) => Promise<MyFoodChangeResponse>>(),
  };
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    api.mergeFoods.mockReset();
    api.mergeFoods.mockImplementation(async (body) => ({
      food: myFood({ name: body.name, per100: body.per100 }),
      updatedItems: body.applyToPast ? 3 : 0,
      updatedEntries: body.applyToPast ? 2 : 0,
      updatedFavorites: 0,
    }));
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  async function setup(): Promise<{ fixture: ComponentFixture<Host>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function checkboxes(el: HTMLElement): HTMLInputElement[] {
    return Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  }

  function radios(el: HTMLElement): HTMLInputElement[] {
    return Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  }

  async function submit(fixture: ComponentFixture<Host>, el: HTMLElement): Promise<void> {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await fixture.whenStable();
  }

  it('lists every variant ticked with its values, times logged and source', async () => {
    const { el } = await setup();
    const boxes = checkboxes(el);
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => box.checked)).toBe(true);
    const rows = Array.from(el.querySelectorAll('ul[aria-label="Names to merge"] li')).map((row) =>
      row.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(rows[0]).toContain('Heinz tomato ketchup');
    expect(rows[0]).toContain('103–118 kcal/100 g · logged 2 times');
    expect(rows[0]).toContain('Estimate');
    expect(rows[1]).toContain('110 kcal/100 g · logged once');
    expect(radios(el).map((radio) => radio.checked)).toEqual([true, false]);
    expect(el.textContent).toContain('Recommended');
    expect(el.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe(
      'Heinz tomato ketchup',
    );
    expect(el.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).toContain('Also fix 3 past items');
  });

  it('marks a saved food that was never logged instead of counting zero logs', async () => {
    const { fixture, el } = await setup();
    const base = ketchupSuggestion();
    fixture.componentInstance.suggestion.set({
      ...base,
      variants: [
        ...base.variants,
        mergeVariant({
          name: 'Ketchup',
          productId: 'ketchup-id',
          timesLogged: 0,
          kcalPer100Min: 100,
          kcalPer100Max: 100,
          valueSource: 'saved',
          recommended: false,
        }),
      ],
    });
    await fixture.whenStable();
    const rows = Array.from(el.querySelectorAll('ul[aria-label="Names to merge"] li')).map((row) =>
      row.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(rows[2]).toContain('100 kcal/100 g · not logged yet');
    expect(rows[2]).toContain('Saved');
    expect(el.textContent).toContain('Also fix 3 past items');
  });

  it('merges the ticked names with the chosen values and fixes past items', async () => {
    const { fixture, el } = await setup();
    const events = TestBed.inject(DataEventsService);
    const entries = events.entries();
    radios(el)[1].click();
    await fixture.whenStable();
    await submit(fixture, el);
    expect(api.mergeFoods).toHaveBeenCalledWith({
      key: 'tomato ketchup',
      names: ['Heinz tomato ketchup', 'Tomato ketchup'],
      name: 'Heinz tomato ketchup',
      basisUnit: 'g',
      per100: per100({ calories: 110, carbs: 25 }),
      productId: null,
      applyToPast: true,
    });
    expect(fixture.componentInstance.open()).toBe(false);
    expect(fixture.componentInstance.merged()?.updatedItems).toBe(3);
    expect(events.entries()).toBe(entries + 1);
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.message),
    ).toContain('Heinz tomato ketchup is now one food · 3 past items updated');
  });

  it('leaves an unticked variant out and can skip past items', async () => {
    const { fixture, el } = await setup();
    checkboxes(el)[1].click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Also fix 2 past items');
    expect(radios(el)).toHaveLength(1);
    (el.querySelector('[role="switch"]') as HTMLButtonElement).click();
    typeInto(el.querySelector<HTMLInputElement>('input[type="text"]')!, 'Heinz ketchup');
    await fixture.whenStable();
    await submit(fixture, el);
    const body = api.mergeFoods.mock.calls[0]![0];
    expect(body).toMatchObject({
      names: ['Heinz tomato ketchup'],
      name: 'Heinz ketchup',
      keptApart: ['Tomato ketchup'],
      applyToPast: false,
    });
    expect(body.per100.calories).toBe(118);
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.message),
    ).toContain('Heinz ketchup is now one food');
  });

  it('renames the food when the recommended variant is unticked', async () => {
    const { fixture, el } = await setup();
    const name = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(name.value).toBe('Heinz tomato ketchup');
    checkboxes(el)[0].click();
    await fixture.whenStable();
    expect(name.value).toBe('Tomato ketchup');
    (el.querySelector('[role="switch"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    await submit(fixture, el);
    expect(api.mergeFoods.mock.calls[0]![0]).toMatchObject({
      names: ['Tomato ketchup'],
      name: 'Tomato ketchup',
      keptApart: ['Heinz tomato ketchup'],
      applyToPast: false,
    });
  });

  it('will not name the food after a variant that is unticked', async () => {
    const { fixture, el } = await setup();
    checkboxes(el)[1].click();
    const name = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    typeInto(name, 'tomato ketchup');
    await fixture.whenStable();
    await submit(fixture, el);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(NAME_KEPT_APART);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(api.mergeFoods).not.toHaveBeenCalled();
    typeInto(name, 'Heinz ketchup');
    await fixture.whenStable();
    expect(el.textContent).not.toContain(NAME_KEPT_APART);
    expect(name.getAttribute('aria-invalid')).toBeNull();
    await submit(fixture, el);
    expect(api.mergeFoods.mock.calls[0]![0]).toMatchObject({
      name: 'Heinz ketchup',
      keptApart: ['Tomato ketchup'],
    });
  });

  it('picks the values of a new duplicate that shares the saved food name', async () => {
    const { fixture, el } = await setup();
    fixture.componentInstance.suggestion.set(bunSuggestion());
    await fixture.whenStable();
    expect(radios(el).map((radio) => radio.checked)).toEqual([true, false]);
    radios(el)[1].click();
    await fixture.whenStable();
    expect(radios(el).map((radio) => radio.checked)).toEqual([false, true]);
    await submit(fixture, el);
    expect(api.mergeFoods).toHaveBeenCalledWith({
      key: 'sofisoft potato bun',
      names: ['Sofisoft potato bun'],
      name: 'Sofisoft potato bun',
      basisUnit: 'g',
      per100: per100({ calories: 320, carbs: 56 }),
      productId: 'food-bun',
      applyToPast: true,
    });
  });

  it('unticks one copy of a shared name and keeps the other', async () => {
    const { fixture, el } = await setup();
    fixture.componentInstance.suggestion.set(bunSuggestion());
    await fixture.whenStable();
    checkboxes(el)[1].click();
    await fixture.whenStable();
    expect(checkboxes(el).map((box) => box.checked)).toEqual([true, false]);
    expect(radios(el)).toHaveLength(1);
    expect(el.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe(
      'Sofisoft potato bun',
    );
    await submit(fixture, el);
    expect(el.textContent).not.toContain(NAME_KEPT_APART);
    const body = api.mergeFoods.mock.calls[0]![0];
    expect(body).toMatchObject({
      names: ['Sofisoft potato bun'],
      productId: 'food-bun',
      per100: { calories: 290 },
    });
    expect(body).not.toHaveProperty('keptApart');
  });

  it('sends the vitamins of the chosen values with the merge', async () => {
    const { fixture, el } = await setup();
    fixture.componentInstance.suggestion.set(
      ketchupSuggestion({
        variants: [
          mergeVariant({ microsPer100: { potassium: 281 } }),
          mergeVariant({
            name: 'Tomato ketchup',
            recommended: false,
            per100: per100({ calories: 110, carbs: 25 }),
            microsPer100: { potassium: 315, vitaminC: 4 },
          }),
        ],
      }),
    );
    await fixture.whenStable();
    radios(el)[1].click();
    await fixture.whenStable();
    await submit(fixture, el);
    expect(api.mergeFoods.mock.calls[0]![0]).toMatchObject({
      per100: { calories: 110 },
      microsPer100: { potassium: 315, vitaminC: 4 },
    });
  });

  it('needs at least one name and a food name', async () => {
    const { fixture, el } = await setup();
    checkboxes(el).forEach((box) => box.click());
    await fixture.whenStable();
    await submit(fixture, el);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Keep at least one name.');
    checkboxes(el)[0].click();
    typeInto(el.querySelector<HTMLInputElement>('input[type="text"]')!, ' ');
    await fixture.whenStable();
    await submit(fixture, el);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Give the food a name.');
    expect(api.mergeFoods).not.toHaveBeenCalled();
  });

  it('shows the error and stays open when the merge fails', async () => {
    api.mergeFoods.mockRejectedValueOnce(new Error('Network down'));
    const { fixture, el } = await setup();
    await submit(fixture, el);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Network down');
    expect(fixture.componentInstance.open()).toBe(true);
  });
});
