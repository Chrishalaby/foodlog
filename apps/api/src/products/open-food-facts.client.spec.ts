import { Logger } from '@nestjs/common';
import {
  OFF_MISS_TTL_MS,
  OFF_TIMEOUT_MS,
  OFF_USER_AGENT,
  type OffFetch,
  offProductUrl,
  OpenFoodFactsClient,
} from './open-food-facts.client.js';

const BARCODE = '5280001234566';

const FOUND_BODY = {
  code: BARCODE,
  status: 1,
  product: {
    product_name: 'Laban Ayran',
    brands: 'Almarai',
    quantity: '1 L',
    nutriments: { 'energy-kcal_100g': 42, proteins_100g: 3.2 },
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFound(): Response {
  return json({ code: BARCODE, status: 0, status_verbose: 'no code' }, 404);
}

function setup(...responses: (() => Promise<Response>)[]) {
  const fetch = vi.fn<OffFetch>();
  for (const response of responses) {
    fetch.mockImplementationOnce(response);
  }
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  return { fetch, warn, client: new OpenFoodFactsClient(fetch) };
}

describe('offProductUrl', () => {
  it('requests only the needed fields of the v2 product API', () => {
    expect(offProductUrl(BARCODE)).toBe(
      `https://world.openfoodfacts.org/api/v2/product/${BARCODE}?fields=code,product_name,brands,nutriments,serving_quantity,serving_size,product_quantity,quantity,image_front_small_url,nutrition_data_per`,
    );
  });
});

describe('OpenFoodFactsClient', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches with the FoodLog user agent and a timeout and maps the product', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { client, fetch } = setup(() => Promise.resolve(json(FOUND_BODY)));

    await expect(client.find(BARCODE)).resolves.toMatchObject({
      name: 'Laban Ayran',
      brand: 'Almarai',
      basisUnit: 'ml',
      per100: { calories: 42, protein: 3.2 },
    });

    expect(timeout).toHaveBeenCalledWith(OFF_TIMEOUT_MS);
    expect(fetch).toHaveBeenCalledWith(offProductUrl(BARCODE), {
      method: 'GET',
      headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
    expect(OFF_USER_AGENT).toBe('FoodLog/1.0 (personal nutrition tracker)');
  });

  it('caches products that are not found for ten minutes', async () => {
    const { client, fetch } = setup(
      () => Promise.resolve(notFound()),
      () => Promise.resolve(json(FOUND_BODY)),
    );

    await expect(client.find(BARCODE)).resolves.toBeNull();
    vi.advanceTimersByTime(OFF_MISS_TTL_MS - 1);
    await expect(client.find(BARCODE)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await expect(client.find(BARCODE)).resolves.not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('caches found responses without energy as misses', async () => {
    const { client, fetch } = setup(() =>
      Promise.resolve(
        json({ status: 1, product: { product_name: 'No energy' } }),
      ),
    );

    await expect(client.find(BARCODE)).resolves.toBeNull();
    await expect(client.find(BARCODE)).resolves.toBeNull();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each<[string, () => Promise<Response>]>([
    [
      'a timeout',
      () =>
        Promise.reject(
          new DOMException('The operation timed out', 'TimeoutError'),
        ),
    ],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['a server error', () => Promise.resolve(json({ error: 'oops' }, 503))],
    ['rate limiting', () => Promise.resolve(json({}, 429))],
    [
      'invalid JSON',
      () => Promise.resolve(new Response('<html>', { status: 200 })),
    ],
    [
      'an oversized body',
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ padding: 'x'.repeat(600_000) })),
        ),
    ],
  ])('treats %s as not found without caching it', async (_label, failure) => {
    const { client, fetch, warn } = setup(failure, () =>
      Promise.resolve(json(FOUND_BODY)),
    );

    await expect(client.find(BARCODE)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(BARCODE);

    await expect(client.find(BARCODE)).resolves.not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent lookups of the same barcode', async () => {
    let resolve: (response: Response) => void = () => {};
    const { client, fetch } = setup(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
      () => Promise.resolve(json(FOUND_BODY)),
    );

    const first = client.find(BARCODE);
    const second = client.find(BARCODE);
    resolve(json(FOUND_BODY));

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(fetch).toHaveBeenCalledTimes(1);

    await client.find(BARCODE);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
