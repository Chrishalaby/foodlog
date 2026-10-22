import { Injectable, computed, inject, signal } from '@angular/core';
import type { CreateFluidLogRequest, FluidDayResponse, FluidLogDto } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { httpStatus } from '../../core/errors';
import { onSessionReset } from '../../core/session-scope';
import {
  FLUID_PENDING_PREFIX,
  fluidDayView,
  isPendingFluid,
  withFluidLog,
  withoutFluidLog,
} from './fluids-model';

export const FLUIDS_CACHE_LIMIT = 14;
export const FLUIDS_MUTATION_LOG_LIMIT = 50;

export type FluidsStatus = 'loading' | 'ready' | 'error';

interface FluidMutation {
  seq: number;
  date: string;
  change: (day: FluidDayResponse) => FluidDayResponse;
}

@Injectable({ providedIn: 'root' })
export class FluidsStore {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly cache = new Map<string, FluidDayResponse>();
  private readonly dateState = signal<string | null>(null);
  private readonly dayState = signal<FluidDayResponse | null>(null);
  private readonly statusState = signal<FluidsStatus>('loading');
  private readonly pendingState = signal<readonly FluidLogDto[]>([]);
  private readonly removingState = signal<ReadonlySet<string>>(new Set());
  private readonly mutations: FluidMutation[] = [];
  private fetchToken = 0;
  private mutationSeq = 0;
  private pendingSeq = 0;

  readonly date = this.dateState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly day = computed<FluidDayResponse | null>(() => {
    const day = this.dayState();
    return day ? fluidDayView(day, this.pendingState(), this.removingState()) : null;
  });

  constructor() {
    onSessionReset(() => this.reset());
  }

  show(date: string): Promise<void> {
    if (date !== this.dateState()) {
      this.dateState.set(date);
      const cached = this.cache.get(date) ?? null;
      this.dayState.set(cached);
      this.statusState.set(cached ? 'ready' : 'loading');
    }
    return this.fetch();
  }

  refresh(): Promise<void> {
    return this.dateState() ? this.fetch() : Promise.resolve();
  }

  retry(): Promise<void> {
    if (!this.dayState()) {
      this.statusState.set('loading');
    }
    return this.refresh();
  }

  reset(): void {
    this.fetchToken++;
    this.mutations.length = 0;
    this.cache.clear();
    this.dateState.set(null);
    this.dayState.set(null);
    this.statusState.set('loading');
    this.pendingState.set([]);
    this.removingState.set(new Set());
  }

  async add(body: CreateFluidLogRequest): Promise<FluidLogDto> {
    const placeholder: FluidLogDto = {
      ...body,
      id: `${FLUID_PENDING_PREFIX}${++this.pendingSeq}`,
      createdAt: new Date().toISOString(),
    };
    this.pendingState.update((pending) => [...pending, placeholder]);
    try {
      const log = await this.api.createFluid(body);
      this.settle(log.localDate, (day) => withFluidLog(day, log));
      this.events.notify('fluids');
      return log;
    } finally {
      this.pendingState.update((pending) => pending.filter((log) => log.id !== placeholder.id));
    }
  }

  async remove(log: FluidLogDto): Promise<void> {
    if (isPendingFluid(log)) {
      return;
    }
    this.setRemoving(log.id, true);
    try {
      await this.api.deleteFluid(log.id);
    } catch (err) {
      if (httpStatus(err) !== 404) {
        throw err;
      }
    } finally {
      this.setRemoving(log.id, false);
    }
    this.settle(log.localDate, (day) => withoutFluidLog(day, log.id));
    this.events.notify('fluids');
  }

  private settle(date: string, change: (day: FluidDayResponse) => FluidDayResponse): void {
    this.mutations.push({ seq: ++this.mutationSeq, date, change });
    if (this.mutations.length > FLUIDS_MUTATION_LOG_LIMIT) {
      this.mutations.shift();
    }
    const current = this.dayState();
    if (current && this.dateState() === date) {
      this.apply(date, change(current));
    } else {
      this.cache.delete(date);
    }
  }

  private setRemoving(id: string, removing: boolean): void {
    this.removingState.update((ids) => {
      const next = new Set(ids);
      if (removing) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  private replay(day: FluidDayResponse, since: number): FluidDayResponse {
    return this.mutations
      .filter((mutation) => mutation.seq > since && mutation.date === day.date)
      .reduce((current, mutation) => mutation.change(current), day);
  }

  private apply(date: string, day: FluidDayResponse): void {
    this.remember(date, day);
    if (this.dateState() === date) {
      this.dayState.set(day);
      this.statusState.set('ready');
    }
  }

  private async fetch(): Promise<void> {
    const date = this.dateState();
    if (!date) {
      return;
    }
    const token = ++this.fetchToken;
    const since = this.mutationSeq;
    try {
      const day = await this.api.fluidDay(date);
      if (token === this.fetchToken && this.dateState() === date) {
        this.apply(date, this.replay({ ...day, date }, since));
      }
    } catch {
      if (token === this.fetchToken && !this.dayState()) {
        this.statusState.set('error');
      }
    }
  }

  private remember(date: string, day: FluidDayResponse): void {
    this.cache.delete(date);
    this.cache.set(date, day);
    while (this.cache.size > FLUIDS_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
    }
  }
}
