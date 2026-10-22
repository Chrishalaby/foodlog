import { Component, effect, input, signal } from '@angular/core';

function objectUrl(blob: Blob): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

@Component({
  selector: 'app-blob-image',
  host: { class: 'block overflow-hidden bg-surface-2' },
  template: `
    @if (url(); as src) {
      <img
        class="size-full object-cover"
        [alt]="alt()"
        decoding="async"
        draggable="false"
        [src]="src"
      />
    }
  `,
})
export class BlobImage {
  readonly blob = input.required<Blob>();
  readonly alt = input('');

  protected readonly url = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const url = objectUrl(this.blob());
      this.url.set(url);
      onCleanup(() => {
        if (url) {
          URL.revokeObjectURL(url);
        }
      });
    });
  }
}
