const SENTENCE_END = /[.!?…:;]$/;

export function appendTranscript(existing: string, transcript: string, max: number): string {
  const addition = transcript.trim();
  if (!addition) {
    return existing.slice(0, max);
  }
  const base = existing.trimEnd();
  if (!base) {
    return addition.slice(0, max);
  }
  const separator = SENTENCE_END.test(base) ? '\n' : ' ';
  return `${base}${separator}${addition}`.slice(0, max);
}

export function formatRecordingTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
