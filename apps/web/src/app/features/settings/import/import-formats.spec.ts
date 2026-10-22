import {
  KG_PER_LB,
  detectImport,
  entryNameFor,
  localTimestamp,
  mealTypeFrom,
  parseImportDate,
  parseImportTime,
  weightsInKg,
} from './import-formats';

const CRONOMETER = [
  'Day,Time,Group,Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g),Saturated (g),Fiber (g),Sugars (g),Sodium (mg),Vitamin D (IU),Calcium (mg),Caffeine (mg)',
  '2025-03-01,8:15 AM,Breakfast,"Oats, Rolled",80.00 g,303,10.6,54,5.3,0.9,8,0.8,4,0,42,',
  '2025-03-01,8:20 AM,Breakfast,Banana,1.00 medium,105,1.3,27,0.4,0.1,3.1,14.4,1,0,6,',
  '2025-03-01,,Lunch,Chicken Breast,150.00 g,248,46.5,0,5.4,1.5,0,0,111,8,15,',
  '2025-03-01,,Snacks,Coffee,1.00 cup,2,0.3,0,0,0,0,0,5,0,5,95',
  ',,Dinner,Missing day,1 g,1,0,0,0,0,0,0,0,0,0,',
].join('\n');

describe('import helpers', () => {
  it('reads ISO and US dates and 12 or 24 hour times', () => {
    expect(parseImportDate('2025-03-01')).toBe('2025-03-01');
    expect(parseImportDate('2025-03-01T10:00:00Z')).toBe('2025-03-01');
    expect(parseImportDate('3/1/2025')).toBe('2025-03-01');
    expect(parseImportDate('2025-02-30')).toBeNull();
    expect(parseImportDate('yesterday')).toBeNull();
    expect(parseImportTime('8:15 AM')).toBe('08:15');
    expect(parseImportTime('12:05 a.m.')).toBe('00:05');
    expect(parseImportTime('12:30 PM')).toBe('12:30');
    expect(parseImportTime('7:45 pm')).toBe('19:45');
    expect(parseImportTime('21:10:00')).toBe('21:10');
    expect(parseImportTime('25:00')).toBeNull();
    expect(parseImportTime(undefined)).toBeNull();
  });

  it('places a local date and time in this device’s time zone', () => {
    expect(new Date(localTimestamp('2025-03-01', '08:15')).getHours()).toBe(8);
  });

  it('maps meal names and times to meal types', () => {
    expect(mealTypeFrom('Breakfast')).toBe('breakfast');
    expect(mealTypeFrom('Supper')).toBe('dinner');
    expect(mealTypeFrom('Snacks')).toBe('snack');
    expect(mealTypeFrom('Uncategorized')).toBe('snack');
    expect(mealTypeFrom('Uncategorized', '13:00')).toBe('lunch');
    expect(mealTypeFrom('Meal 4', '19:30')).toBe('dinner');
  });

  it('names a meal after its foods', () => {
    const item = (name: string) => ({ name, grams: 0, nutrients: {} as never });
    expect(entryNameFor([item('Oats')], 'Breakfast')).toBe('Oats');
    expect(entryNameFor([item('Oats'), item('Banana')], 'Breakfast')).toBe('Oats and Banana');
    expect(
      entryNameFor([item('Oats'), item('Banana'), item('Milk'), item('Honey')], 'Breakfast'),
    ).toBe('Oats, Banana and 2 more');
    expect(entryNameFor([], 'Breakfast')).toBe('Breakfast');
  });
});

describe('detectImport', () => {
  it('groups a Cronometer food log into meals with grams, counts and vitamins', () => {
    const plan = detectImport('servings.csv', CRONOMETER)!;
    expect(plan).toMatchObject({
      source: 'cronometer',
      label: 'Cronometer food log',
      firstDate: '2025-03-01',
      lastDate: '2025-03-01',
      skippedRows: 1,
    });
    expect(plan.entries.map((entry) => [entry.name, entry.mealType])).toEqual([
      ['Oats, Rolled and Banana', 'breakfast'],
      ['Chicken Breast', 'lunch'],
      ['Coffee', 'snack'],
    ]);
    const [breakfast, lunch, snack] = plan.entries;
    expect(new Date(breakfast!.timestamp).getHours()).toBe(8);
    expect(new Date(breakfast!.timestamp).getMinutes()).toBe(15);
    expect(new Date(lunch!.timestamp).getHours()).toBe(13);
    expect(breakfast!.items[0]).toMatchObject({ name: 'Oats, Rolled', grams: 80, count: null });
    expect(breakfast!.items[1]).toMatchObject({
      grams: 0,
      count: 1,
      unit: 'medium',
      unitPlural: 'mediums',
    });
    expect(lunch!.items[0]?.nutrients).toMatchObject({
      calories: 248,
      protein: 46.5,
      fat: 5.4,
      satFat: 1.5,
      sodium: 111,
    });
    expect(lunch!.items[0]?.micros).toEqual({ vitaminD: 0.2, calcium: 15 });
    expect(snack!.items[0]?.micros).toMatchObject({ caffeine: 95 });
  });

  it('reads Cronometer biometrics with their units', () => {
    const plan = detectImport(
      'biometrics.csv',
      'Day,Time,Metric,Unit,Amount\n2025-03-01,,Weight,lbs,181.5\n2025-03-01,,Body Fat,%,21\n2025-03-02,,Weight,lbs,181\n2025-03-02,,Heart Rate,bpm,60',
    )!;
    expect(plan.label).toBe('Cronometer biometrics');
    expect(plan.weightUnit).toBe('lb');
    expect(plan.weights).toEqual([
      { date: '2025-03-01', value: 181.5, bodyFatPct: 21 },
      { date: '2025-03-02', value: 181, bodyFatPct: null },
    ]);
    expect(weightsInKg(plan, 'kg')[0]).toEqual({
      date: '2025-03-01',
      weightKg: Math.round(181.5 * KG_PER_LB * 100) / 100,
      bodyFatPct: 21,
    });
  });

  it('turns a MyFitnessPal nutrition summary into one entry per meal', () => {
    const plan = detectImport(
      'Nutrition-Summary-2025-03-01-to-2025-03-07.csv',
      'Date,Meal,Time,Calories,Fat (g),Saturated Fat,Cholesterol,Sodium (mg),Potassium,Carbohydrates (g),Fiber,Sugar,Protein (g),Note\n2025-03-01,Breakfast,7:58 AM,420,12,4,210,380,300,55,6,20,24,with honey\n2025-03-01,Dinner,,780,30,10,90,1200,800,80,9,10,45,',
    )!;
    expect(plan.source).toBe('myfitnesspal');
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries[0]).toMatchObject({
      name: 'Breakfast',
      mealType: 'breakfast',
      description: 'with honey',
      items: [
        {
          name: 'Breakfast (MyFitnessPal)',
          grams: 0,
          nutrients: {
            calories: 420,
            fat: 12,
            satFat: 4,
            sodium: 380,
            carbs: 55,
            fiber: 6,
            sugar: 20,
            protein: 24,
          },
          micros: { cholesterol: 210, potassium: 300 },
        },
      ],
    });
    expect(new Date(plan.entries[1]!.timestamp).getHours()).toBe(20);
  });

  it('reads weigh-ins from any CSV with date and weight, asking for the unit when unsure', () => {
    const plain = detectImport(
      'scale.csv',
      'date,weight\n2025-03-01,82.4\n2025-03-02,\nnot a date,80',
    )!;
    expect(plain).toMatchObject({
      source: 'csv',
      label: 'Weight log',
      weightUnit: null,
      skippedRows: 2,
    });
    expect(weightsInKg(plain, 'lb')[0]?.weightKg).toBe(Math.round(82.4 * KG_PER_LB * 100) / 100);
    expect(weightsInKg(plain, 'kg')[0]?.weightKg).toBe(82.4);

    const labeled = detectImport(
      'Measurement-Summary.csv',
      'Date,Weight (lbs),Body Fat %\n3/1/2025,180,22',
    )!;
    expect(labeled).toMatchObject({ source: 'myfitnesspal', weightUnit: 'lb' });
    expect(labeled.weights[0]).toEqual({ date: '2025-03-01', value: 180, bodyFatPct: 22 });
    expect(
      weightsInKg(
        { ...labeled, weights: [{ date: '2025-03-01', value: 2000, bodyFatPct: 99 }] },
        'kg',
      ),
    ).toEqual([]);
  });

  it('reads FoodLog’s own CSV export back into entries', () => {
    const plan = detectImport(
      'foodlog-export-2025-03-02.csv',
      'date,time,meal_type,entry_name,item_name,grams,calories,protein_g,carbs_g,fat_g,sat_fat_g,fiber_g,sugar_g,sodium_mg,alcohol_g,confidence,source,description,entry_id\n2025-03-01,13:05,lunch,Chicken bowl,Chicken,150,240,45,0,5,1.4,0,0,110,0,high,database,,e1\n2025-03-01,13:05,lunch,Chicken bowl,Rice,180,232,4.8,51,0.5,0.1,0.7,0,2,0,medium,database,,e1',
    )!;
    expect(plan.source).toBe('foodlog');
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({ name: 'Chicken bowl', mealType: 'lunch' });
    expect(plan.entries[0]!.items.map((item) => [item.name, item.grams, item.confidence])).toEqual([
      ['Chicken', 150, 'high'],
      ['Rice', 180, 'medium'],
    ]);
  });

  it('restores a FoodLog JSON backup with weights, water and training days', () => {
    const backup = {
      exportedAt: '2025-03-03T10:00:00.000Z',
      entries: [
        {
          name: 'Eggs and toast',
          mealType: 'breakfast',
          timestamp: '2025-03-01T07:00:00.000Z',
          localDate: '2025-03-01',
          description: null,
          portion: null,
          items: [
            {
              name: 'Egg',
              grams: 100,
              nutrients: { calories: 143, protein: 12.6 },
              confidence: 'high',
              count: 2,
              unit: 'egg',
              unitPlural: 'eggs',
              productId: 'gone',
              micros: { vitaminB12: 0.9 },
              fluidMl: null,
            },
          ],
        },
        { name: 'Broken', mealType: 'brunch', items: [] },
      ],
      weights: [
        { date: '2025-03-01', weightKg: 80.2, bodyFatPct: null },
        { date: 'x', weightKg: 1 },
      ],
      fluids: [
        {
          id: 'f',
          localDate: '2025-03-01',
          timestamp: '2025-03-01T09:00:00.000Z',
          ml: 330,
          kind: 'water',
        },
      ],
      days: [
        { date: '2025-03-01', trainingDay: true },
        { date: '2025-03-02', trainingDay: false },
      ],
    };
    const plan = detectImport('foodlog-export.json', JSON.stringify(backup))!;
    expect(plan).toMatchObject({
      source: 'foodlog',
      label: 'FoodLog backup',
      weightUnit: 'kg',
      skippedRows: 1,
    });
    expect(plan.entries[0]?.items[0]).toEqual({
      name: 'Egg',
      grams: 100,
      nutrients: {
        calories: 143,
        protein: 12.6,
        carbs: 0,
        fat: 0,
        satFat: 0,
        fiber: 0,
        sugar: 0,
        sodium: 0,
        alcohol: 0,
      },
      confidence: 'high',
      count: 2,
      unit: 'egg',
      unitPlural: 'eggs',
      micros: { vitaminB12: 0.9 },
      fluidMl: null,
    });
    expect(plan.weights).toEqual([{ date: '2025-03-01', value: 80.2, bodyFatPct: null }]);
    expect(plan.fluids).toHaveLength(1);
    expect(plan.trainingDays).toEqual(['2025-03-01']);
  });

  it('refuses files it does not understand', () => {
    expect(detectImport('photo.json', 'not json')).toBeNull();
    expect(detectImport('other.json', '{"hello":1}')).toBeNull();
    expect(detectImport('random.csv', 'a,b\n1,2')).toBeNull();
  });
});
