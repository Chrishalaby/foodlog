import { Component, DOCUMENT, computed, inject, input, signal } from '@angular/core';
import type { Micros, MicrosCoverage } from '@food/shared';
import { MicrosCard } from '../../shared/ui/micros/micros-card';
import { hasMicros } from '../../shared/utils/micros';

export const DAY_MICROS_STORAGE_KEY = 'foodlog.today.micros';

function resolveStorage(document: Document): Storage | null {
  try {
    return document.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readMicrosExpanded(storage: Storage | null): boolean {
  try {
    return storage?.getItem(DAY_MICROS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMicrosExpanded(storage: Storage | null, expanded: boolean): void {
  try {
    storage?.setItem(DAY_MICROS_STORAGE_KEY, expanded ? '1' : '0');
  } catch {
    return;
  }
}

@Component({
  selector: 'app-day-micros',
  imports: [MicrosCard],
  host: { class: 'block', '[class.hidden]': '!visible()' },
  template: `
    @if (visible()) {
      <app-micros-card
        scope="day"
        [micros]="micros()"
        [coverage]="coverage()"
        [expanded]="expanded()"
        (expandedChange)="setExpanded($event)"
      />
    }
  `,
})
export class DayMicros {
  private readonly storage = resolveStorage(inject(DOCUMENT));

  readonly micros = input<Micros | null>(null);
  readonly coverage = input<MicrosCoverage | null>(null);

  protected readonly expanded = signal(readMicrosExpanded(this.storage));
  protected readonly visible = computed(
    () => (this.coverage()?.items ?? 0) > 0 || hasMicros(this.micros()),
  );

  protected setExpanded(expanded: boolean): void {
    this.expanded.set(expanded);
    writeMicrosExpanded(this.storage, expanded);
  }
}
