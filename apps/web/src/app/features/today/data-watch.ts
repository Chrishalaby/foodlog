import { DestroyRef, effect, inject, untracked } from '@angular/core';
import { DataEventsService, type DataTopic } from '../../core/data-events.service';

export const DATA_REFRESH_DEBOUNCE_MS = 150;

export interface DataWatch {
  notifyOthers(...topics: DataTopic[]): void;
  flush(): void;
  cancel(): void;
}

export function watchData(
  topics: readonly DataTopic[],
  onChange: (changed: ReadonlySet<DataTopic>) => void,
  debounceMs: number = DATA_REFRESH_DEBOUNCE_MS,
): DataWatch {
  const events = inject(DataEventsService);
  const version = (topic: DataTopic): number => events[topic]();
  const seen = new Map<DataTopic, number>(
    topics.map((topic) => [topic, untracked(() => version(topic))]),
  );
  const pending = new Set<DataTopic>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stopTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = (): void => {
    stopTimer();
    if (pending.size === 0) {
      return;
    }
    const changed = new Set(pending);
    pending.clear();
    onChange(changed);
  };

  effect(() => {
    const current = topics.map((topic) => [topic, version(topic)] as const);
    untracked(() => {
      let dirty = false;
      for (const [topic, value] of current) {
        if (seen.get(topic) !== value) {
          seen.set(topic, value);
          pending.add(topic);
          dirty = true;
        }
      }
      if (dirty) {
        stopTimer();
        timer = setTimeout(flush, debounceMs);
      }
    });
  });

  inject(DestroyRef).onDestroy(stopTimer);

  return {
    notifyOthers: (...changed: DataTopic[]) => {
      events.notify(...changed);
      for (const topic of changed) {
        if (seen.has(topic)) {
          seen.set(topic, version(topic));
        }
      }
    },
    flush,
    cancel: () => {
      stopTimer();
      pending.clear();
    },
  };
}
