import {
  isEmptyNoteUpdate,
  NOTE_PHOTO_ROLE,
  notePhotoRows,
  noteUpdateData,
} from './note-data.js';

const NOW = new Date('2026-10-07T09:30:00.000Z');

describe('notePhotoRows', () => {
  it('numbers the photos in upload order', () => {
    expect(notePhotoRows(['p0', 'p1', 'p2'])).toEqual([
      { photoId: 'p0', position: 0 },
      { photoId: 'p1', position: 1 },
      { photoId: 'p2', position: 2 },
    ]);
    expect(notePhotoRows([])).toEqual([]);
  });

  it('stores note photos with the regular photo encoding', () => {
    expect(NOTE_PHOTO_ROLE).toBe('food');
  });
});

describe('isEmptyNoteUpdate', () => {
  it('is empty only when neither text nor done is sent', () => {
    expect(isEmptyNoteUpdate({})).toBe(true);
    expect(isEmptyNoteUpdate({ text: '' })).toBe(false);
    expect(isEmptyNoteUpdate({ done: false })).toBe(false);
    expect(isEmptyNoteUpdate({ text: 'Buy mirror', done: true })).toBe(false);
  });
});

describe('noteUpdateData', () => {
  it('changes only the text when done is not sent', () => {
    expect(noteUpdateData({ text: 'Buy mirror' }, false, NOW)).toEqual({
      text: 'Buy mirror',
    });
    expect(noteUpdateData({ text: '' }, true, NOW)).toEqual({ text: '' });
  });

  it('marks an open note done now', () => {
    expect(noteUpdateData({ done: true }, false, NOW)).toEqual({
      done: true,
      doneAt: NOW,
    });
  });

  it('leaves the done time of a note that is already done', () => {
    expect(noteUpdateData({ done: true }, true, NOW)).toEqual({});
    expect(noteUpdateData({ text: 'Bought', done: true }, true, NOW)).toEqual({
      text: 'Bought',
    });
  });

  it('reopens a note and clears its done time', () => {
    expect(noteUpdateData({ done: false }, true, NOW)).toEqual({
      done: false,
      doneAt: null,
    });
    expect(noteUpdateData({ done: false }, false, NOW)).toEqual({
      done: false,
      doneAt: null,
    });
  });
});
