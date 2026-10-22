import { Inject, Injectable, Logger } from '@nestjs/common';
import { ExpiringSet } from './expiring-set.js';
import {
  mapOffResponse,
  OFF_PRODUCT_FIELDS,
  type OffProduct,
} from './open-food-facts.mapper.js';

export type OffFetch = (url: string, init: RequestInit) => Promise<Response>;

export const OFF_FETCH = Symbol('OFF_FETCH');

export const OFF_BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';
export const OFF_USER_AGENT = 'FoodLog/1.0 (personal nutrition tracker)';
export const OFF_TIMEOUT_MS = 4000;
export const OFF_MISS_TTL_MS = 10 * 60 * 1000;
export const OFF_MISS_CACHE_MAX = 5000;
export const OFF_BODY_MAX_CHARS = 512 * 1024;

const HTTP_NOT_FOUND = 404;

type FetchOutcome =
  | { kind: 'found'; product: OffProduct }
  | { kind: 'missing' }
  | { kind: 'failed' };

export function offProductUrl(barcode: string): string {
  const fields = OFF_PRODUCT_FIELDS.join(',');
  return `${OFF_BASE_URL}/${encodeURIComponent(barcode)}?fields=${fields}`;
}

export const defaultOffFetch: OffFetch = (url, init) => fetch(url, init);

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

@Injectable()
export class OpenFoodFactsClient {
  private readonly logger = new Logger(OpenFoodFactsClient.name);
  private readonly misses = new ExpiringSet(
    OFF_MISS_TTL_MS,
    OFF_MISS_CACHE_MAX,
  );
  private readonly pending = new Map<string, Promise<OffProduct | null>>();

  constructor(@Inject(OFF_FETCH) private readonly fetchProduct: OffFetch) {}

  find(barcode: string): Promise<OffProduct | null> {
    if (this.misses.has(barcode)) {
      return Promise.resolve(null);
    }
    const inFlight = this.pending.get(barcode);
    if (inFlight) {
      return inFlight;
    }
    const lookup = this.lookup(barcode).finally(() => {
      this.pending.delete(barcode);
    });
    this.pending.set(barcode, lookup);
    return lookup;
  }

  private async lookup(barcode: string): Promise<OffProduct | null> {
    const outcome = await this.request(barcode);
    if (outcome.kind === 'missing') {
      this.misses.add(barcode);
    }
    return outcome.kind === 'found' ? outcome.product : null;
  }

  private async request(barcode: string): Promise<FetchOutcome> {
    try {
      const response = await this.fetchProduct(offProductUrl(barcode), {
        method: 'GET',
        headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
      });
      return await this.readResponse(barcode, response);
    } catch (error) {
      this.logger.warn(
        `Open Food Facts lookup for ${barcode} failed: ${describeError(error)}`,
      );
      return { kind: 'failed' };
    }
  }

  private async readResponse(
    barcode: string,
    response: Response,
  ): Promise<FetchOutcome> {
    if (response.status === HTTP_NOT_FOUND) {
      await response.body?.cancel();
      return { kind: 'missing' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      this.logger.warn(
        `Open Food Facts lookup for ${barcode} returned HTTP ${response.status}`,
      );
      return { kind: 'failed' };
    }
    const text = await response.text();
    if (text.length > OFF_BODY_MAX_CHARS) {
      this.logger.warn(
        `Open Food Facts response for ${barcode} is too large (${text.length} characters)`,
      );
      return { kind: 'failed' };
    }
    const product = mapOffResponse(JSON.parse(text) as unknown, barcode);
    return product ? { kind: 'found', product } : { kind: 'missing' };
  }
}
