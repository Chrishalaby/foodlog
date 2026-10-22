import { Injectable, signal } from '@angular/core';

export type DataTopic = 'entries' | 'favorites' | 'weights' | 'profile' | 'products' | 'fluids';

@Injectable({ providedIn: 'root' })
export class DataEventsService {
  private readonly versions = {
    entries: signal(0),
    favorites: signal(0),
    weights: signal(0),
    profile: signal(0),
    products: signal(0),
    fluids: signal(0),
  } satisfies Record<DataTopic, ReturnType<typeof signal<number>>>;

  readonly entries = this.versions.entries.asReadonly();
  readonly favorites = this.versions.favorites.asReadonly();
  readonly weights = this.versions.weights.asReadonly();
  readonly profile = this.versions.profile.asReadonly();
  readonly products = this.versions.products.asReadonly();
  readonly fluids = this.versions.fluids.asReadonly();

  notify(...topics: DataTopic[]): void {
    for (const topic of topics) {
      this.versions[topic].update((v) => v + 1);
    }
  }
}
