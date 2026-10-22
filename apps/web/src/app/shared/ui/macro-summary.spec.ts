import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type Nutrients, zeroNutrients } from '@food/shared';
import { MacroSummary, tileFitExpression, tileFontSize, valueWidthEm } from './macro-summary';

@Component({
  imports: [MacroSummary],
  template: `<app-macro-summary [nutrients]="nutrients()" [(expanded)]="expanded" />`,
})
class Host {
  readonly nutrients = signal<Nutrients>({
    ...zeroNutrients(),
    calories: 6750,
    protein: 148.5,
    carbs: 1234.5,
    fat: 19.2,
    satFat: 12.3,
    sodium: 2345,
  });
  readonly expanded = signal(false);
}

describe('MacroSummary', () => {
  it('estimates value widths from digits and separators', () => {
    expect(valueWidthEm('6,750')).toBeCloseTo(0.64 * 4 + 0.32);
    expect(valueWidthEm('')).toBeCloseTo(0.64);
    expect(tileFitExpression('6,750', 0)).toBe('calc((100cqi - 0px) / 2.88)');
    expect(tileFontSize([{ value: '6,750', reservePx: 0 }])).toBe(
      'clamp(12px, min(calc((100cqi - 0px) / 2.88)), 17px)',
    );
    expect(
      tileFontSize([
        { value: '6,750', reservePx: 0 },
        { value: '148.5', reservePx: 12 },
      ]),
    ).toBe('clamp(12px, min(calc((100cqi - 0px) / 2.88), calc((100cqi - 12px) / 2.88)), 17px)');
    expect(tileFontSize([])).toBe('clamp(12px, 17px, 17px)');
  });

  it('drops the visible kcal unit, keeps it for screen readers and auto-sizes values', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const tiles = Array.from(el.querySelectorAll('.grid > div'));
    expect(tiles).toHaveLength(4);

    const [calories, protein, carbs] = tiles;
    const caloriesValue = calories!.children[1] as HTMLElement;
    expect(caloriesValue.textContent?.replace(/\s+/g, ' ').trim()).toBe('6,750 kcal');
    expect(caloriesValue.querySelector('.sr-only')?.textContent?.trim()).toBe('kcal');
    expect(caloriesValue.className).toContain('tabular-nums');
    expect(caloriesValue.className).toContain('whitespace-nowrap');
    expect(caloriesValue.style.fontSize).toContain('100cqi');
    expect((protein!.children[1] as HTMLElement).style.fontSize).toBe(caloriesValue.style.fontSize);

    const proteinValue = protein!.children[1] as HTMLElement;
    expect(proteinValue.querySelector('.sr-only')).toBeNull();
    expect(proteinValue.textContent?.replace(/\s+/g, '')).toBe('148.5g');
    expect(carbs!.children[1]!.textContent?.replace(/\s+/g, '')).toBe('1,235g');
  });

  it('uses container queries so tiles adapt to narrow sheets', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const summary = el.querySelector('app-macro-summary')!;
    expect(summary.classList.contains('@container')).toBe(true);
    const grid = summary.querySelector('.grid')!;
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('@min-[18rem]:grid-cols-4');
  });

  it('expands to the remaining nutrients with a 44 px toggle', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const toggle = el.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.className).toContain('min-h-11');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.expanded()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const rows = Array.from(el.querySelectorAll('dl > div')).map((row) =>
      row.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toContain('Saturated fat 12.3 g');
    expect(rows).toContain('Sodium 2,345 mg');
  });
});
