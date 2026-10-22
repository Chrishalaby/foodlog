import { contrastRatio } from '../../shared/charts/contrast';
import { DARK_CHART_PALETTE, LIGHT_CHART_PALETTE } from '../../shared/charts/echarts';
import {
  fluidAddLabel,
  fluidDayView,
  fluidDrinkRows,
  fluidLogRows,
  fluidMlError,
  fluidPercent,
  fluidProgressText,
  fluidSummaryNote,
  fluidTargetReached,
  formatLitres,
  formatMl,
  isPendingFluid,
  isValidFluidMl,
  withFluidLog,
  withoutFluidLog,
} from './fluids-model';
import { makeFluidDay, makeFluidDrink, makeFluidLog } from './today-fixtures';

const DAY = '2026-09-28';

describe('fluids model', () => {
  it('shows progress in litres against the target', () => {
    expect(fluidProgressText(1400, 2800)).toBe('1.4 / 2.8 L');
    expect(fluidProgressText(0, 2500)).toBe('0.0 / 2.5 L');
    expect(fluidProgressText(580, 2750)).toBe('0.58 / 2.75 L');
    expect(formatLitres(1449)).toBe('1.45');
    expect(formatLitres(2750)).toBe('2.75');
    expect(formatLitres(Number.NaN)).toBe('0.0');
    expect(formatMl(330)).toBe('330 ml');
    expect(formatMl(1250)).toBe('1,250 ml');
  });

  it('never shows the target as met before it is', () => {
    expect(fluidProgressText(2745, 2750)).toBe('2.74 / 2.75 L');
    expect(fluidProgressText(2795, 2800)).toBe('2.79 / 2.8 L');
    expect(fluidPercent(2795, 2800)).toBe(99);
    expect(fluidTargetReached(2795, 2800)).toBe(false);
    expect(fluidTargetReached(2800, 2800)).toBe(true);
    expect(fluidTargetReached(500, 0)).toBe(false);
  });

  it('computes the percent of the target without dividing by zero', () => {
    expect(fluidPercent(1400, 2800)).toBe(50);
    expect(fluidPercent(3100, 2800)).toBe(110);
    expect(fluidPercent(500, 0)).toBe(0);
  });

  it('labels adds by amount and kind', () => {
    expect(fluidAddLabel(250, 'water')).toBe('250 ml water');
    expect(fluidAddLabel(330, 'coffee')).toBe('330 ml coffee');
  });

  it('accepts whole amounts between 10 and 3000 ml', () => {
    expect(isValidFluidMl(10)).toBe(true);
    expect(isValidFluidMl(3000)).toBe(true);
    expect(isValidFluidMl(9)).toBe(false);
    expect(isValidFluidMl(3001)).toBe(false);
    expect(isValidFluidMl(12.5)).toBe(false);
    expect(isValidFluidMl(null)).toBe(false);
    expect(fluidMlError(5)).toBe('Enter 10–3,000 ml.');
    expect(fluidMlError(null)).toBe('Enter an amount in ml.');
    expect(fluidMlError(400)).toBeNull();
  });

  it('adds and removes logs while keeping the totals and caffeine in sync', () => {
    const day = makeFluidDay(
      DAY,
      [makeFluidLog({ id: 'a', ml: 500 })],
      [makeFluidDrink({ itemId: 'i1' })],
    );
    const coffee = makeFluidLog({
      id: 'b',
      ml: 250,
      kind: 'coffee',
      timestamp: '2026-09-28T07:00:00.000Z',
    });
    const added = withFluidLog(day, coffee);
    expect(added.logs.map((log) => log.id)).toEqual(['b', 'a']);
    expect(added.logsMl).toBe(750);
    expect(added.totalMl).toBe(1080);
    expect(added.caffeineMg).toBe(100);
    expect(withFluidLog(added, coffee)).toBe(added);
    expect(withFluidLog(day, { ...coffee, localDate: '2026-09-27' })).toBe(day);

    const removed = withoutFluidLog(added, 'a');
    expect(removed.logsMl).toBe(250);
    expect(removed.totalMl).toBe(580);
    expect(withoutFluidLog(removed, 'missing')).toBe(removed);
  });

  it('overlays pending adds and hides logs being deleted', () => {
    const day = makeFluidDay(DAY, [makeFluidLog({ id: 'a', ml: 500 })]);
    const pending = makeFluidLog({
      id: 'pending-1',
      ml: 250,
      timestamp: '2026-09-28T09:00:00.000Z',
    });
    const other = makeFluidLog({ id: 'pending-2', ml: 250, localDate: '2026-09-27' });

    const view = fluidDayView(day, [pending, other], new Set(['a']));
    expect(view.logs.map((log) => log.id)).toEqual(['pending-1']);
    expect(view.totalMl).toBe(250);
    expect(fluidDayView(day, [], new Set())).toBe(day);
    expect(isPendingFluid(pending)).toBe(true);
    expect(isPendingFluid(day.logs[0]!)).toBe(false);
  });

  it('lists the newest logs first with accessible labels', () => {
    const rows = fluidLogRows([
      makeFluidLog({ id: 'a', timestamp: '2026-09-28T06:00:00.000Z' }),
      makeFluidLog({
        id: 'pending-3',
        kind: 'tea',
        ml: 300,
        timestamp: '2026-09-28T09:00:00.000Z',
      }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['pending-3', 'a']);
    expect(rows[0]).toMatchObject({ title: 'Tea', amount: '300 ml', pending: true });
    expect(rows[0]!.label).toMatch(/^Tea, 300 ml at /);
  });

  it('lists drinks from meals read-only, newest first', () => {
    const rows = fluidDrinkRows(
      makeFluidDay(
        DAY,
        [],
        [
          makeFluidDrink({
            itemId: 'i1',
            name: 'Soy milk',
            ml: 200,
            timestamp: '2026-09-28T07:00:00.000Z',
            entryName: 'Breakfast',
          }),
          makeFluidDrink({ itemId: 'i2' }),
        ],
      ),
    );
    expect(rows.map((row) => row.name)).toEqual(['Diet Pepsi', 'Soy milk']);
    expect(rows[0]).toEqual({
      key: 'entry-i2:i2',
      name: 'Diet Pepsi',
      amount: '330 ml',
      entryName: 'Chicken burger meal',
      label: 'Diet Pepsi, 330 ml, from Chicken burger meal',
    });
  });

  it('summarises drinks from meals and caffeine', () => {
    expect(fluidSummaryNote({ foodMl: 330, caffeineMg: 100 })).toBe(
      '330 ml from meals · 100 mg caffeine from coffee & tea',
    );
    expect(fluidSummaryNote({ foodMl: 0, caffeineMg: 0 })).toBe('');
  });

  it('keeps the fluid colour readable in both themes', () => {
    expect(contrastRatio('#4fc3ff', DARK_CHART_PALETTE.surface)!).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#0b6aa6', LIGHT_CHART_PALETTE.surface)!).toBeGreaterThanOrEqual(4.5);
  });
});
