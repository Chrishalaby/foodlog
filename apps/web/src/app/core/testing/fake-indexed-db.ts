type Handler = ((event: Event) => void) | null;

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;

  succeed(value: T): void {
    this.result = value;
    this.onsuccess?.(new Event('success'));
  }

  fail(error: DOMException): void {
    this.error = error;
    this.onerror?.(new Event('error'));
  }
}

class FakeTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: DOMException | null = null;
  private pending = 0;

  constructor(
    private readonly database: FakeDatabase,
    private readonly storeName: string,
    private readonly failWrites: boolean,
  ) {}

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.database.records(this.storeName), this);
  }

  track<T>(request: FakeRequest<T>, work: () => T, write: boolean): FakeRequest<T> {
    this.pending += 1;
    setTimeout(() => {
      if (write && this.failWrites) {
        const error = new DOMException('Quota exceeded', 'QuotaExceededError');
        this.error = error;
        request.fail(error);
        this.onerror?.(new Event('error'));
        return;
      }
      request.succeed(work());
      this.pending -= 1;
      if (this.pending === 0) {
        setTimeout(() => this.oncomplete?.(new Event('complete')));
      }
    });
    return request;
  }
}

class FakeObjectStore {
  constructor(
    private readonly records: Map<string, unknown>,
    private readonly transaction: FakeTransaction,
  ) {}

  getAll(): FakeRequest<unknown[]> {
    return this.transaction.track(
      new FakeRequest<unknown[]>(),
      () => [...this.records.values()].map((value) => structuredClone(value)),
      false,
    );
  }

  put(value: { localId: string }): FakeRequest<string> {
    const copy = structuredClone(value);
    return this.transaction.track(
      new FakeRequest<string>(),
      () => {
        this.records.set(copy.localId, copy);
        return copy.localId;
      },
      true,
    );
  }

  delete(key: string): FakeRequest<undefined> {
    return this.transaction.track(
      new FakeRequest<undefined>(),
      () => {
        this.records.delete(key);
        return undefined;
      },
      true,
    );
  }
}

class FakeDatabase {
  onversionchange: Handler = null;
  readonly stores = new Map<string, Map<string, unknown>>();
  failWrites = false;

  get objectStoreNames(): { contains: (name: string) => boolean } {
    return { contains: (name: string) => this.stores.has(name) };
  }

  createObjectStore(name: string): void {
    this.stores.set(name, new Map());
  }

  records(name: string): Map<string, unknown> {
    const store = this.stores.get(name);
    if (!store) {
      throw new DOMException(`No object store ${name}`, 'NotFoundError');
    }
    return store;
  }

  transaction(name: string): FakeTransaction {
    return new FakeTransaction(this, name, this.failWrites);
  }

  close(): void {
    return;
  }
}

export class FakeIndexedDb {
  readonly databases = new Map<string, FakeDatabase>();
  openCalls = 0;
  failOpen = false;

  open(name: string): FakeRequest<FakeDatabase> {
    this.openCalls += 1;
    const request = new FakeRequest<FakeDatabase>();
    setTimeout(() => {
      if (this.failOpen) {
        request.fail(new DOMException('Private mode', 'InvalidStateError'));
        return;
      }
      let database = this.databases.get(name);
      if (!database) {
        database = new FakeDatabase();
        this.databases.set(name, database);
        request.result = database;
        request.onupgradeneeded?.(new Event('upgradeneeded'));
      }
      request.succeed(database);
    });
    return request;
  }

  setFailWrites(name: string, fail: boolean): void {
    const database = this.databases.get(name);
    if (database) {
      database.failWrites = fail;
    }
  }

  asFactory(): IDBFactory {
    return this as unknown as IDBFactory;
  }
}
