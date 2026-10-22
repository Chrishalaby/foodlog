export class ExpiringSet {
  private readonly expiries = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.expiries.size;
  }

  has(key: string): boolean {
    const expiresAt = this.expiries.get(key);
    if (expiresAt === undefined) {
      return false;
    }
    if (expiresAt <= this.now()) {
      this.expiries.delete(key);
      return false;
    }
    return true;
  }

  add(key: string): void {
    this.expiries.delete(key);
    this.expiries.set(key, this.now() + this.ttlMs);
    this.evictOverflow();
  }

  delete(key: string): void {
    this.expiries.delete(key);
  }

  private evictOverflow(): void {
    for (const key of this.expiries.keys()) {
      if (this.expiries.size <= this.maxSize) {
        return;
      }
      this.expiries.delete(key);
    }
  }
}
