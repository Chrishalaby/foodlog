import { appendTranscript, formatRecordingTime } from './voice-text';

describe('appendTranscript', () => {
  it('uses the transcript alone when nothing was typed', () => {
    expect(appendTranscript('', ' 2 eggs and toast ', 2000)).toBe('2 eggs and toast');
    expect(appendTranscript('   \n', '2 eggs', 2000)).toBe('2 eggs');
  });

  it('adds the transcript after a space when the text does not end a sentence', () => {
    expect(appendTranscript('grilled chicken', 'with 150 g rice', 2000)).toBe(
      'grilled chicken with 150 g rice',
    );
    expect(appendTranscript('grilled chicken   ', 'with rice', 2000)).toBe(
      'grilled chicken with rice',
    );
  });

  it('starts a new line when the existing text ends a sentence', () => {
    expect(appendTranscript('2 eggs.', 'For lunch a shawarma wrap', 2000)).toBe(
      '2 eggs.\nFor lunch a shawarma wrap',
    );
    expect(appendTranscript('Anything else?  ', 'labneh', 2000)).toBe('Anything else?\nlabneh');
    expect(appendTranscript('Breakfast:', '2 manakish', 2000)).toBe('Breakfast:\n2 manakish');
  });

  it('keeps the existing text when the transcript is empty', () => {
    expect(appendTranscript('2 eggs', '   ', 2000)).toBe('2 eggs');
  });

  it('never exceeds the description limit', () => {
    expect(appendTranscript('abcde', 'fghij', 8)).toBe('abcde fg');
    expect(appendTranscript('', 'abcdefghij', 4)).toBe('abcd');
    expect(appendTranscript('x'.repeat(10), 'more', 10)).toBe('x'.repeat(10));
  });
});

describe('formatRecordingTime', () => {
  it('formats seconds as m:ss', () => {
    expect(formatRecordingTime(0)).toBe('0:00');
    expect(formatRecordingTime(7.9)).toBe('0:07');
    expect(formatRecordingTime(65)).toBe('1:05');
    expect(formatRecordingTime(180)).toBe('3:00');
    expect(formatRecordingTime(-4)).toBe('0:00');
  });
});
