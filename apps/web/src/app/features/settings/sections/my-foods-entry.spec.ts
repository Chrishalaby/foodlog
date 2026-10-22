import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiService } from '../../../core/api.service';
import { MAYO, ketchupSuggestion, myFood } from '../../../shared/testing/my-foods-fixtures';
import { MY_FOODS_PATH, MyFoodsEntry } from './my-foods-entry';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('MyFoodsEntry', () => {
  const api = { listMyFoods: vi.fn(), foodMergeSuggestions: vi.fn() };

  beforeEach(() => {
    api.listMyFoods.mockReset();
    api.foodMergeSuggestions.mockReset();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(MyFoodsEntry);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('links to My foods with the saved count and what is waiting for review', async () => {
    api.listMyFoods.mockResolvedValue([myFood(), MAYO]);
    api.foodMergeSuggestions.mockResolvedValue({ suggestions: [ketchupSuggestion()] });
    const el = await render();
    const link = el.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(MY_FOODS_PATH);
    expect(link.textContent?.replace(/\s+/g, ' ')).toContain('2 saved foods · 1 to review');
    expect(link.textContent).toContain('food to review');
  });

  it('explains the idea before anything is saved', async () => {
    api.listMyFoods.mockRejectedValue(new Error('offline'));
    api.foodMergeSuggestions.mockResolvedValue({ suggestions: [] });
    const el = await render();
    expect(el.textContent).toContain('Same food, same values, every time');
  });
});
