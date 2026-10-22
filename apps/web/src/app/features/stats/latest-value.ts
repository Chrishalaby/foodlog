import { linkedSignal, type Resource, type Signal } from '@angular/core';

export function latestValue<T>(source: Resource<T | undefined>): Signal<T | undefined> {
  return linkedSignal<T | undefined, T | undefined>({
    source: () => (source.hasValue() ? source.value() : undefined),
    computation: (value, previous) => value ?? previous?.value,
  });
}
