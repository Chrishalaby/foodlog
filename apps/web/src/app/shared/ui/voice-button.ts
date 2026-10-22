import {
  Component,
  DOCUMENT,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { AiAvailability } from '../../core/ai-availability.service';
import { VoiceRecorderService } from '../../core/voice-recorder.service';
import { formatRecordingTime } from '../utils/voice-text';
import { Icon } from './icon';
import { Spinner } from './spinner';

@Component({
  selector: 'app-voice-button',
  imports: [Icon, Spinner],
  providers: [VoiceRecorderService],
  host: {
    class: 'flex-col items-end gap-1.5',
    '[class.flex]': 'shown()',
    '[class.hidden]': '!shown()',
  },
  template: `
    @if (shown()) {
      @switch (state()) {
        @case ('recording') {
          <div
            class="flex max-w-full animate-fade-in items-center gap-1 rounded-full border border-danger/40 bg-danger/10 py-1 pr-1 pl-3.5"
            role="group"
            aria-label="Voice recording"
          >
            <span class="relative flex size-2.5 shrink-0" aria-hidden="true">
              <span
                class="absolute inline-flex size-full rounded-full bg-danger opacity-70 motion-safe:animate-ping"
              ></span>
              <span class="relative inline-flex size-2.5 rounded-full bg-danger"></span>
            </span>
            <span class="sr-only" role="status">Recording</span>
            <span
              class="min-w-10 pl-1.5 text-sm font-semibold text-fg tabular-nums"
              [attr.aria-label]="'Recording time ' + time()"
            >
              {{ time() }}
            </span>
            <button
              type="button"
              class="btn btn-ghost btn-icon text-muted"
              aria-label="Cancel recording"
              (click)="cancel()"
            >
              <app-icon name="close" [size]="18" />
            </button>
            <button
              type="button"
              class="btn btn-primary rounded-full px-4"
              data-voice-stop
              (click)="stop()"
            >
              <app-icon name="stop" [size]="14" />
              Stop
            </button>
          </div>
          @if (endingSoon()) {
            <p class="text-xs leading-snug text-muted">Stops at {{ limit }}.</p>
          }
        }
        @case ('transcribing') {
          <div
            class="flex min-h-11 animate-fade-in items-center gap-2 pr-1 text-sm font-medium text-muted"
            role="status"
          >
            <app-spinner [size]="18" label="Transcribing" />
            Transcribing…
          </div>
        }
        @default {
          <button
            type="button"
            class="btn btn-secondary btn-icon text-fg"
            aria-label="Describe by voice"
            [disabled]="disabled() || state() === 'starting'"
            [attr.aria-busy]="state() === 'starting'"
            (click)="start()"
          >
            @if (state() === 'starting') {
              <app-spinner [size]="18" label="Starting the microphone" />
            } @else {
              <app-icon name="mic" [size]="20" />
            }
          </button>
        }
      }
      @if (error(); as message) {
        <p class="max-w-full text-right text-xs leading-snug text-danger" role="alert">
          {{ message }}
        </p>
        @if (canResend()) {
          <button
            type="button"
            class="btn btn-secondary min-h-11 px-3.5 text-sm"
            data-voice-resend
            (click)="resend()"
          >
            <app-icon name="refresh" [size]="16" />
            Send recording again
          </button>
        }
      }
    }
  `,
})
export class VoiceButton {
  private readonly recorder = inject(VoiceRecorderService);
  private readonly ai = inject(AiAvailability);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private keepFocus = false;

  readonly disabled = input(false);
  readonly transcribed = output<string>();

  protected readonly supported = this.recorder.supported;
  protected readonly shown = computed(() => this.supported && this.ai.voice());
  protected readonly limit = formatRecordingTime(this.recorder.maxSeconds);
  protected readonly state = this.recorder.state;
  protected readonly error = this.recorder.error;
  protected readonly canResend = this.recorder.canResend;
  protected readonly time = computed(() => formatRecordingTime(this.recorder.seconds()));
  protected readonly endingSoon = computed(
    () => this.recorder.seconds() >= this.recorder.maxSeconds - 15,
  );

  readonly busy = computed(() => this.recorder.state() !== 'idle');

  constructor() {
    afterRenderEffect(() => {
      this.state();
      untracked(() => this.restoreFocus());
    });
  }

  start(): void {
    if (this.disabled()) {
      return;
    }
    this.rememberFocus();
    void this.recorder.start((text) => this.deliver(text));
  }

  cancel(): void {
    this.rememberFocus();
    this.recorder.cancel();
  }

  protected async stop(): Promise<void> {
    this.rememberFocus();
    this.deliver(await this.recorder.stop());
  }

  protected async resend(): Promise<void> {
    this.rememberFocus();
    this.deliver(await this.recorder.resend());
  }

  private rememberFocus(): void {
    this.keepFocus = this.host.nativeElement.contains(this.document.activeElement);
  }

  private restoreFocus(): void {
    const active = this.document.activeElement;
    if (!this.keepFocus || (active !== null && active !== this.document.body)) {
      return;
    }
    const host = this.host.nativeElement;
    const target =
      host.querySelector<HTMLElement>('[data-voice-stop]') ??
      host.querySelector<HTMLElement>('button:not([disabled])');
    target?.focus({ preventScroll: true });
  }

  private deliver(text: string | null): void {
    if (text) {
      this.transcribed.emit(text);
    }
  }
}
