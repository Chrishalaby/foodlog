import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  FoodMergeSuggestionsResponse,
  MergeFoodsRequest,
  MyFoodChangeResponse,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MyFoodsStore } from '../../core/my-foods.store';
import { ToastService } from '../../core/toast.service';
import { installDialogShim } from '../../shared/testing/dialog-shim';
import { ketchupSuggestion, mayoSuggestion, myFood } from '../../shared/testing/my-foods-fixtures';
import { FoodMergeCard } from './food-merge-card';
import { mergeCardStorageKey } from './merge-card-memory';

@Component({
  imports: [FoodMergeCard],
  template: `<app-food-merge-card [today]="today()" />`,
})
class Host {
  readonly today = signal('2026-09-30');
}

const STORAGE_KEY = mergeCardStorageKey('user-1');
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function buttonWith(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  );
}

describe('FoodMergeCard', () => {
  const api = {
    foodMergeSuggestions: vi.fn<() => Promise<FoodMergeSuggestionsResponse>>(),
    dismissFoodMerge: vi.fn<(body: { key: string }) => Promise<void>>(),
    mergeFoods: vi.fn<(body: MergeFoodsRequest) => Promise<MyFoodChangeResponse>>(),
  };
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    localStorage.removeItem(STORAGE_KEY);
    Object.values(api).forEach((mock) => mock.mockReset());
    api.foodMergeSuggestions.mockResolvedValue({
      suggestions: [ketchupSuggestion(), mayoSuggestion()],
    });
    api.dismissFoodMerge.mockResolvedValue(undefined);
    api.mergeFoods.mockResolvedValue({
      food: myFood(),
      updatedItems: 3,
      updatedEntries: 2,
      updatedFavorites: 0,
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user: signal({ id: 'user-1' }) } },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    localStorage.removeItem(STORAGE_KEY);
    restoreDialog();
  });

  async function render(): Promise<{ fixture: ComponentFixture<Host>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function card(el: HTMLElement): HTMLElement | null {
    return el.querySelector('section[aria-labelledby="food-merge-card-title"]');
  }

  it('shows one suggestion a day with its spread of values', async () => {
    const { el } = await render();
    expect(card(el)?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Tomato ketchup was logged 3 ways (103–118 kcal/100 g). Make it one food?',
    );
    expect(buttonWith(card(el)!, 'Don’t ask for tomato ketchup')).toBeDefined();
    expect(el.querySelectorAll('section[aria-labelledby="food-merge-card-title"]')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      date: '2026-09-30',
      key: 'tomato ketchup',
      snoozedUntil: null,
    });
  });

  it('opens the merge sheet and shows nothing else that day after merging', async () => {
    const { fixture, el } = await render();
    buttonWith(card(el)!, 'Review')!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Also fix 3 past items');
    api.foodMergeSuggestions.mockResolvedValue({ suggestions: [mayoSuggestion()] });
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await fixture.whenStable();
    expect(api.mergeFoods).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'tomato ketchup', applyToPast: true }),
    );
    expect(
      TestBed.inject(MyFoodsStore)
        .suggestions()
        .map((item) => item.key),
    ).toEqual(['mayo']);
    expect(card(el)).toBeNull();

    fixture.componentInstance.today.set('2026-10-01');
    await fixture.whenStable();
    expect(card(el)?.textContent).toContain('Mayonnaise, regular was logged 3 ways');
  });

  it('snoozes until tomorrow with “Not now”', async () => {
    const { fixture, el } = await render();
    buttonWith(card(el)!, 'Not now')!.click();
    await fixture.whenStable();
    expect(card(el)).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).snoozedUntil).toBe('2026-10-01');
    expect(api.dismissFoodMerge).not.toHaveBeenCalled();

    fixture.destroy();
    const again = await render();
    expect(card(again.el)).toBeNull();
    again.fixture.componentInstance.today.set('2026-10-01');
    await again.fixture.whenStable();
    expect(card(again.el)?.textContent).toContain('Tomato ketchup');
  });

  it('stops asking about a food it was told not to ask about', async () => {
    const { fixture, el } = await render();
    buttonWith(card(el)!, 'Don’t ask for tomato ketchup')!.click();
    await flush();
    await fixture.whenStable();
    expect(api.dismissFoodMerge).toHaveBeenCalledWith({ key: 'tomato ketchup' });
    expect(card(el)).toBeNull();
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.message),
    ).toContain('We won’t ask about tomato ketchup again.');
  });

  it('brings the card back when dismissing fails', async () => {
    api.dismissFoodMerge.mockRejectedValueOnce(new Error('Offline'));
    const { fixture, el } = await render();
    buttonWith(card(el)!, 'Don’t ask')!.click();
    await flush();
    await fixture.whenStable();
    expect(card(el)?.textContent).toContain('Tomato ketchup');
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.message),
    ).toContain('Offline');
  });

  it('stays hidden without suggestions or when they fail to load', async () => {
    api.foodMergeSuggestions.mockRejectedValueOnce(new Error('offline'));
    const { el } = await render();
    expect(card(el)).toBeNull();
    expect(el.querySelector('app-food-merge-card')?.classList.contains('hidden')).toBe(true);
  });
});
