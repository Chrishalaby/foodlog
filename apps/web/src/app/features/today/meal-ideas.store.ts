import { Injectable, inject, signal } from '@angular/core';
import {
  API_LIMITS,
  toLocalDateTimeInput,
  type EntryDto,
  type MealIdea,
  type MealIdeasRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DataEventsService } from '../../core/data-events.service';
import { httpStatus } from '../../core/errors';
import { onSessionReset } from '../../core/session-scope';
import type { AnalyzeFailure } from '../log/analyze-errors';
import {
  describeIdeasError,
  ideaLogPlan,
  ideaLogTopics,
  isFresh,
  type IdeaLogPlan,
} from './meal-ideas-model';
import { logMomentFor } from './today-view';

export type MealIdeasStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface IdeasContext {
  date: string;
  basis: string;
}

export interface AskOptions {
  note?: string;
  different?: boolean;
}

@Injectable({ providedIn: 'root' })
export class MealIdeasStore {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly events = inject(DataEventsService);
  private readonly statusState = signal<MealIdeasStatus>('idle');
  private readonly ideasState = signal<readonly MealIdea[]>([]);
  private readonly summaryState = signal('');
  private readonly failureState = signal<AnalyzeFailure | null>(null);
  private readonly loggingState = signal<string | null>(null);
  private readonly noteState = signal('');
  private basis: string | null = null;
  private askedAt = 0;
  private shown: string[] = [];
  private token = 0;

  readonly status = this.statusState.asReadonly();
  readonly ideas = this.ideasState.asReadonly();
  readonly summary = this.summaryState.asReadonly();
  readonly failure = this.failureState.asReadonly();
  readonly logging = this.loggingState.asReadonly();
  readonly note = this.noteState.asReadonly();

  constructor() {
    onSessionReset(() => this.reset());
  }

  setNote(note: string): void {
    this.noteState.set(note.slice(0, API_LIMITS.mealIdeaNoteMax));
  }

  open(context: IdeasContext, now: Date = new Date()): Promise<void> {
    const sameDay = this.basis === context.basis;
    if (sameDay && this.statusState() === 'loading') {
      return Promise.resolve();
    }
    if (sameDay && this.statusState() === 'ready' && isFresh(this.askedAt, now.getTime())) {
      return Promise.resolve();
    }
    return this.ask(context, {}, now);
  }

  async ask(
    context: IdeasContext,
    options: AskOptions = {},
    now: Date = new Date(),
  ): Promise<void> {
    const token = ++this.token;
    if (options.note !== undefined) {
      this.setNote(options.note);
    }
    if (this.basis !== context.basis || !options.different) {
      this.shown = [];
    }
    this.basis = context.basis;
    this.statusState.set('loading');
    this.failureState.set(null);
    try {
      const response = await this.api.mealIdeas(this.request(context.date, now));
      if (token !== this.token) {
        return;
      }
      this.ideasState.set(response.ideas);
      this.summaryState.set(response.summary);
      this.shown = [...this.shown, ...response.ideas.map((idea) => idea.title)];
      this.askedAt = now.getTime();
      this.statusState.set('ready');
    } catch (err) {
      if (token !== this.token) {
        return;
      }
      this.failureState.set(describeIdeasError(err, { admin: this.auth.isAdmin() }));
      this.statusState.set('error');
    }
  }

  async log(idea: MealIdea, date: string, now: Date = new Date()): Promise<EntryDto> {
    const plan = ideaLogPlan(idea);
    this.loggingState.set(idea.title);
    try {
      const entry = await this.create(idea, plan, date, now);
      this.basis = null;
      this.events.notify(...ideaLogTopics(plan));
      return entry;
    } finally {
      this.loggingState.set(null);
    }
  }

  reset(): void {
    this.token++;
    this.basis = null;
    this.askedAt = 0;
    this.shown = [];
    this.statusState.set('idle');
    this.ideasState.set([]);
    this.summaryState.set('');
    this.failureState.set(null);
    this.loggingState.set(null);
    this.noteState.set('');
  }

  private request(date: string, now: Date): MealIdeasRequest {
    const note = this.noteState().trim();
    const exclude = this.shown.slice(-API_LIMITS.mealIdeaExcludeMax);
    return {
      localDate: date,
      localTime: toLocalDateTimeInput(now),
      ...(note ? { note } : {}),
      ...(exclude.length > 0 ? { exclude } : {}),
    };
  }

  private async create(
    idea: MealIdea,
    plan: IdeaLogPlan,
    date: string,
    now: Date,
  ): Promise<EntryDto> {
    const moment = logMomentFor(date, now);
    const when = {
      timestamp: moment.timestamp,
      localDate: moment.localDate,
      mealType: idea.mealType,
    };
    if (plan.kind === 'quick') {
      try {
        return await this.api.quickLog({ key: plan.key, servings: plan.servings, ...when });
      } catch (err) {
        if (httpStatus(err) !== 404) {
          throw err;
        }
      }
    }
    return this.api.createEntry({
      name: idea.title,
      source: plan.kind === 'entry' ? plan.source : 'copy',
      items: plan.items,
      ...when,
    });
  }
}
