import type { Readable } from 'node:stream';

export abstract class StorageService {
  abstract put(key: string, data: Buffer, contentType: string): Promise<void>;

  abstract get(key: string): Promise<Buffer>;

  abstract getStream(key: string): Promise<Readable>;

  abstract delete(key: string): Promise<void>;
}
