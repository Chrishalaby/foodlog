import { type EntryDto, type Nutrients, zeroNutrients } from '@food/shared';
import { CSV_BOM } from './csv.js';
import { buildEntriesCsv, EXPORT_CSV_COLUMNS } from './export-csv.js';

const HEADER =
  'date,time,meal_type,entry_name,item_name,grams,calories,protein_g,carbs_g,fat_g,sat_fat_g,fiber_g,sugar_g,sodium_mg,alcohol_g,confidence,source,description,entry_id';

function nutrients(overrides: Partial<Nutrients>): Nutrients {
  return { ...zeroNutrients(), ...overrides };
}

function entry(overrides: Partial<EntryDto> = {}): EntryDto {
  return {
    id: '0199a1b2-0000-7000-8000-000000000001',
    name: 'Lunch bowl',
    description: null,
    mealType: 'lunch',
    source: 'food_photo',
    timestamp: '2026-09-28T11:45:00.000Z',
    localDate: '2026-09-28',
    items: [
      {
        id: 'item-1',
        position: 0,
        name: 'Rice',
        grams: 150,
        nutrients: nutrients({ calories: 195, protein: 4.1, carbs: 42.9 }),
        confidence: 'high',
        count: null,
        unit: null,
        unitPlural: null,
        productId: null,
        micros: null,
        fluidMl: null,
      },
      {
        id: 'item-2',
        position: 1,
        name: 'Chicken',
        grams: 120.5,
        nutrients: nutrients({
          calories: 198,
          protein: 37.3,
          fat: 4.3,
          satFat: 1.2,
          sodium: 89,
        }),
        confidence: null,
        count: null,
        unit: null,
        unitPlural: null,
        productId: null,
        micros: null,
        fluidMl: null,
      },
    ],
    totals: nutrients({ calories: 393, protein: 41.4 }),
    portion: null,
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: '2026-09-28T11:46:00.000Z',
    updatedAt: '2026-09-28T11:46:00.000Z',
    ...overrides,
  };
}

function lines(csv: string): string[] {
  return csv.slice(CSV_BOM.length).split('\r\n');
}

describe('buildEntriesCsv', () => {
  it('writes the contract header even without entries', () => {
    expect(EXPORT_CSV_COLUMNS.join(',')).toBe(HEADER);
    expect(buildEntriesCsv([])).toBe(`${CSV_BOM}${HEADER}\r\n`);
  });

  it('writes one row per item in position order', () => {
    const rows = lines(buildEntriesCsv([entry()]));
    expect(rows).toEqual([
      HEADER,
      '2026-09-28,2026-09-28T11:45:00.000Z,lunch,Lunch bowl,Rice,150,195,4.1,42.9,0,0,0,0,0,0,high,food_photo,,0199a1b2-0000-7000-8000-000000000001',
      '2026-09-28,2026-09-28T11:45:00.000Z,lunch,Lunch bowl,Chicken,120.5,198,37.3,0,4.3,1.2,0,0,89,0,,food_photo,,0199a1b2-0000-7000-8000-000000000001',
      '',
    ]);
  });

  it('quotes names and descriptions with commas, quotes and newlines', () => {
    const csv = buildEntriesCsv([
      entry({
        name: 'Mom\'s "famous" chili, extra hot',
        description: 'Leftovers\nfrom Sunday',
        items: [{ ...entry().items[0]!, name: 'Beans, kidney' }],
      }),
    ]);
    expect(csv).toContain(
      '"Mom\'s ""famous"" chili, extra hot","Beans, kidney",150,',
    );
    expect(csv).toContain(',"Leftovers\nfrom Sunday",');
  });

  it('neutralizes spreadsheet formulas in user-provided text', () => {
    const csv = buildEntriesCsv([
      entry({
        name: '=cmd|"/c calc"!A1',
        description: '@SUM(1,2)',
        items: [{ ...entry().items[0]!, name: '+protein shake' }],
      }),
    ]);
    const row = lines(csv)[1]!;
    expect(row).toContain(',"\'=cmd|""/c calc""!A1",');
    expect(row).toContain(",'+protein shake,");
    expect(row).toContain(',"\'@SUM(1,2)",');
  });

  it('falls back to entry totals when an entry has no items', () => {
    const rows = lines(
      buildEntriesCsv([entry({ items: [], source: 'manual' })]),
    );
    expect(rows[1]).toBe(
      '2026-09-28,2026-09-28T11:45:00.000Z,lunch,Lunch bowl,,,393,41.4,0,0,0,0,0,0,0,,manual,,0199a1b2-0000-7000-8000-000000000001',
    );
  });

  it('rounds nutrients to their display precision', () => {
    const csv = buildEntriesCsv([
      entry({
        items: [
          {
            ...entry().items[0]!,
            nutrients: nutrients({
              calories: 195.4999,
              sodium: 12.6,
              fat: 1.04,
            }),
          },
        ],
      }),
    ]);
    expect(lines(csv)[1]).toContain(',Rice,150,195,0,0,1,0,0,0,13,0,');
  });
});
