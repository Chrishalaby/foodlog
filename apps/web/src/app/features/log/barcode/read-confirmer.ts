export const REQUIRED_READS = 2;
export const MAX_READ_GAP_MS = 1500;

export class ReadConfirmer {
  private candidate: string | null = null;
  private count = 0;
  private lastAt = 0;

  constructor(
    private readonly required: number = REQUIRED_READS,
    private readonly maxGapMs: number = MAX_READ_GAP_MS,
  ) {}

  get pending(): string | null {
    return this.candidate;
  }

  push(code: string, at: number, required: number = this.required): string | null {
    const continues = code === this.candidate && at - this.lastAt <= this.maxGapMs;
    this.count = continues ? this.count + 1 : 1;
    this.candidate = code;
    this.lastAt = at;
    return this.count >= required ? code : null;
  }

  reset(): void {
    this.candidate = null;
    this.count = 0;
    this.lastAt = 0;
  }
}

export function pickCandidate(codes: readonly string[], pending: string | null): string | null {
  if (pending !== null && codes.includes(pending)) {
    return pending;
  }
  return codes[0] ?? null;
}
