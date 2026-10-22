import { Component, input, output, signal } from '@angular/core';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import type { RawAiState } from './entry-edit.store';

let nextPanelId = 0;

@Component({
  selector: 'app-raw-ai-panel',
  imports: [Icon, Spinner],
  host: { class: 'block' },
  template: `
    <section class="card overflow-hidden">
      <button
        type="button"
        class="flex min-h-13 w-full items-center gap-3 px-3.5 text-left transition hover:bg-surface-2"
        [attr.aria-expanded]="expanded()"
        [attr.aria-controls]="contentId"
        (click)="toggle()"
      >
        <span class="flex size-9 items-center justify-center rounded-xl bg-surface-2 text-muted">
          <app-icon name="info" [size]="18" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-fg">AI debug</span>
          <span class="block text-xs text-muted">Raw model response for this entry</span>
        </span>
        <app-icon
          class="text-muted transition-transform duration-200"
          name="chevron-down"
          [class.rotate-180]="expanded()"
        />
      </button>
      @if (expanded()) {
        <div class="border-t border-line/60 p-3.5" [id]="contentId">
          @switch (state().status) {
            @case ('ready') {
              @if (state().text; as text) {
                <div class="mb-2 flex justify-end">
                  <button
                    type="button"
                    class="btn btn-ghost -my-1 px-3 text-xs text-muted"
                    (click)="copyJson.emit(text)"
                  >
                    <app-icon name="copy" [size]="14" />
                    Copy JSON
                  </button>
                </div>
                <pre
                  class="max-h-[60dvh] overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-[11px] leading-relaxed whitespace-pre text-fg/90"
                  tabindex="0"
                  aria-label="Raw AI JSON"
                  >{{ text }}</pre>
              } @else {
                <p class="text-sm text-muted">No AI data is stored for this entry.</p>
              }
            }
            @case ('error') {
              <div class="flex items-center gap-3 text-sm">
                <app-icon class="text-warn" name="alert" />
                <span class="flex-1 text-muted">{{ state().error }}</span>
                <button
                  type="button"
                  class="btn btn-ghost px-3 text-brand"
                  (click)="loadRequested.emit()"
                >
                  Retry
                </button>
              </div>
            }
            @default {
              <div class="flex items-center justify-center py-4 text-muted">
                <app-spinner label="Loading AI data" />
              </div>
            }
          }
        </div>
      }
    </section>
  `,
})
export class RawAiPanel {
  readonly state = input.required<RawAiState>();
  readonly loadRequested = output<void>();
  readonly copyJson = output<string>();

  protected readonly contentId = `raw-ai-${nextPanelId++}`;
  protected readonly expanded = signal(false);

  protected toggle(): void {
    const next = !this.expanded();
    this.expanded.set(next);
    if (next && this.state().status !== 'ready' && this.state().status !== 'loading') {
      this.loadRequested.emit();
    }
  }
}
