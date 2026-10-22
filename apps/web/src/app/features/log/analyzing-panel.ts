import { Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import { Icon } from '../../shared/ui/icon';
import { analyzingProgress, analyzingStage, tipFor } from './log-helpers';
import { LogStore } from './log.store';
import { StickyActions } from './sticky-actions';

const TICK_MS = 500;

@Component({
  selector: 'app-analyzing-panel',
  imports: [Icon, StickyActions],
  host: { class: 'block animate-fade-in' },
  templateUrl: './analyzing-panel.html',
  styleUrl: './analyzing-panel.css',
})
export class AnalyzingPanel {
  protected readonly store = inject(LogStore);
  private readonly now = signal(Date.now());

  readonly cancel = output<void>();

  protected readonly seconds = computed(() =>
    Math.max(0, Math.floor((this.now() - this.store.analyzeStartedAt()) / 1000)),
  );
  protected readonly stage = computed(() =>
    analyzingStage(
      this.seconds(),
      this.store.mode(),
      this.store.runKind(),
      this.store.analyzingPhotoCount(),
    ),
  );
  protected readonly extraPhotos = computed(() =>
    this.store.runKind() === 'initial' ? Math.max(0, this.store.photos().length - 1) : 0,
  );
  protected readonly progress = computed(() => analyzingProgress(this.seconds()));
  protected readonly tip = computed(() => tipFor(this.seconds()));
  protected readonly quote = computed(
    () => this.store.analysis()?.description ?? this.store.description().trim(),
  );
  protected readonly precise = computed(
    () => this.store.precise() || this.store.runKind() === 'recheck',
  );

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
