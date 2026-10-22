import { Injectable, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SheetStack {
  private readonly entries = signal<readonly object[]>([]);

  readonly hasOpen = computed(() => this.entries().length > 0);
  readonly top = computed(() => this.entries().at(-1) ?? null);

  push(owner: object): void {
    this.entries.update((list) => [...list.filter((entry) => entry !== owner), owner]);
  }

  remove(owner: object): void {
    if (this.entries().includes(owner)) {
      this.entries.update((list) => list.filter((entry) => entry !== owner));
    }
  }
}
