import { Component, DOCUMENT, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/ui/icon';

export const COPIED_RESET_MS = 2000;
export const SHARE_FAILED_MESSAGE = 'Could not open sharing. Copy the link instead.';
export const COPY_FAILED_MESSAGE = 'Could not copy. Press and hold the link to copy it.';

export interface ShareContent {
  title: string;
  text: string;
  url: string;
}

export function canShare(nav: Navigator | undefined, content: ShareContent): boolean {
  if (!nav || typeof nav.share !== 'function') {
    return false;
  }
  try {
    return typeof nav.canShare !== 'function' || nav.canShare(content);
  } catch {
    return false;
  }
}

export function whatsappUrl(content: ShareContent): string {
  return `https://wa.me/?text=${encodeURIComponent(`${content.text}\n${content.url}`)}`;
}

function legacyCopy(doc: Document, text: string): boolean {
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.appendChild(area);
  area.select();
  try {
    return typeof doc.execCommand === 'function' && doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

export async function copyText(doc: Document, text: string): Promise<boolean> {
  const clipboard = doc.defaultView?.navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopy(doc, text);
    }
  }
  return legacyCopy(doc, text);
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

@Component({
  selector: 'app-share-link',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div class="rounded-2xl border border-line/70 bg-surface-2 p-3">
      <div class="flex items-center gap-2 text-xs font-semibold text-muted">
        <app-icon name="link" [size]="14" />
        {{ caption() }}
      </div>
      <input
        class="mt-1.5 block w-full truncate bg-transparent font-mono text-[13px] text-fg outline-none select-all"
        readonly
        [value]="url()"
        [attr.aria-label]="caption()"
        (focus)="selectAll($event)"
      />
    </div>
    <div class="mt-3 grid grid-cols-2 gap-2">
      <button
        type="button"
        class="btn min-h-12"
        [class.btn-primary]="!shareSupported()"
        [class.btn-secondary]="shareSupported()"
        (click)="copy()"
      >
        <app-icon [name]="copied() ? 'check' : 'copy'" [size]="18" />
        {{ copied() ? 'Copied' : 'Copy link' }}
      </button>
      @if (shareSupported()) {
        <button type="button" class="btn btn-primary min-h-12" (click)="share()">
          <app-icon name="share" [size]="18" />
          Share…
        </button>
      } @else {
        <a
          class="btn btn-secondary min-h-12"
          target="_blank"
          rel="noopener noreferrer"
          [href]="whatsappHref()"
        >
          <app-icon name="share" [size]="18" />
          WhatsApp
        </a>
      }
    </div>
    <span class="sr-only" aria-live="polite">{{ copied() ? 'Link copied' : '' }}</span>
  `,
})
export class ShareLink {
  private readonly document = inject(DOCUMENT);
  private readonly toast = inject(ToastService);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly url = input.required<string>();
  readonly title = input('FoodLog');
  readonly text = input('');
  readonly caption = input('Link');

  protected readonly copied = signal(false);
  protected readonly content = computed<ShareContent>(() => ({
    title: this.title(),
    text: this.text(),
    url: this.url(),
  }));
  protected readonly shareSupported = computed(() =>
    canShare(this.document.defaultView?.navigator, this.content()),
  );
  protected readonly whatsappHref = computed(() => whatsappUrl(this.content()));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  protected selectAll(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  protected async copy(): Promise<void> {
    const ok = await copyText(this.document, this.url());
    if (!ok) {
      this.toast.error(COPY_FAILED_MESSAGE);
      return;
    }
    this.clearTimer();
    this.copied.set(true);
    this.copiedTimer = setTimeout(() => {
      this.copiedTimer = null;
      this.copied.set(false);
    }, COPIED_RESET_MS);
  }

  protected async share(): Promise<void> {
    const nav = this.document.defaultView?.navigator;
    if (!nav || typeof nav.share !== 'function') {
      return this.copy();
    }
    try {
      await nav.share(this.content());
    } catch (err) {
      if (!isAbort(err)) {
        this.toast.error(SHARE_FAILED_MESSAGE);
      }
    }
  }

  private clearTimer(): void {
    if (this.copiedTimer !== null) {
      clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
  }
}
