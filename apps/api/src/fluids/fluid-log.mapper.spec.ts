import {
  fluidLogCreateData,
  fluidLogUpdateData,
  toFluidLogDto,
} from './fluid-log.mapper.js';

const LOG_ID = '019a0000-0000-7000-8000-0000000000a1';

describe('toFluidLogDto', () => {
  it('maps a stored log with ISO times', () => {
    expect(
      toFluidLogDto({
        id: LOG_ID,
        localDate: '2026-10-01',
        timestamp: new Date('2026-10-01T21:56:00.000Z'),
        ml: 250,
        kind: 'water',
        createdAt: new Date('2026-10-01T21:56:02.000Z'),
      }),
    ).toEqual({
      id: LOG_ID,
      localDate: '2026-10-01',
      timestamp: '2026-10-01T21:56:00.000Z',
      ml: 250,
      kind: 'water',
      createdAt: '2026-10-01T21:56:02.000Z',
    });
  });
});

describe('fluidLogCreateData', () => {
  it('rounds to whole millilitres and keeps the client local date', () => {
    expect(
      fluidLogCreateData({
        ml: 330.4,
        kind: 'other',
        timestamp: '2026-10-02T00:56:00+03:00',
        localDate: '2026-10-01',
      }),
    ).toEqual({
      ml: 330,
      kind: 'other',
      timestamp: new Date('2026-10-01T21:56:00.000Z'),
      localDate: '2026-10-01',
    });
  });
});

describe('fluidLogUpdateData', () => {
  it('changes only the fields that were sent', () => {
    expect(fluidLogUpdateData({})).toEqual({});
    expect(fluidLogUpdateData({ ml: 199.6 })).toEqual({ ml: 200 });
    expect(fluidLogUpdateData({ kind: 'tea' })).toEqual({ kind: 'tea' });
    expect(
      fluidLogUpdateData({
        timestamp: '2026-10-01T07:00:00.000Z',
        localDate: '2026-10-01',
      }),
    ).toEqual({
      timestamp: new Date('2026-10-01T07:00:00.000Z'),
      localDate: '2026-10-01',
    });
  });
});
