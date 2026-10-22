import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  zeroNutrients,
  type AnalyzeResponse,
  type EntryListResponse,
  type UserDto,
} from '@food/shared';
import { ApiService, toHttpParams } from './api.service';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists entries with query params, omitting undefined values', async () => {
    const response: EntryListResponse = { items: [], nextCursor: null };
    const promise = api.listEntries({ from: '2026-09-01', to: undefined, limit: 20, q: '' });
    const req = http.expectOne((r) => r.url === '/api/entries');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().sort()).toEqual(['from', 'limit']);
    expect(req.request.params.get('from')).toBe('2026-09-01');
    expect(req.request.params.get('limit')).toBe('20');
    req.flush(response);
    await expect(promise).resolves.toEqual(response);
  });

  it('reads, creates, updates and deletes fluid logs', async () => {
    const day = api.fluidDay('2026-10-01');
    const get = http.expectOne((r) => r.url === '/api/fluids');
    expect(get.request.method).toBe('GET');
    expect(get.request.params.get('date')).toBe('2026-10-01');
    get.flush({ date: '2026-10-01', logs: [], drinks: [] });
    await expect(day).resolves.toMatchObject({ date: '2026-10-01' });

    const body = {
      ml: 250,
      kind: 'water' as const,
      timestamp: '2026-10-01T21:56:00.000Z',
      localDate: '2026-10-01',
    };
    const created = api.createFluid(body);
    const post = http.expectOne('/api/fluids');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual(body);
    post.flush({ id: 'f/1', ...body, createdAt: body.timestamp });
    await expect(created).resolves.toMatchObject({ id: 'f/1' });

    const updated = api.updateFluid('f/1', { ml: 330 });
    const put = http.expectOne('/api/fluids/f%2F1');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ ml: 330 });
    put.flush({ id: 'f/1', ...body, ml: 330, createdAt: body.timestamp });
    await expect(updated).resolves.toMatchObject({ ml: 330 });

    const removed = api.deleteFluid('f/1');
    const del = http.expectOne('/api/fluids/f%2F1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
    await expect(removed).resolves.toBeUndefined();
  });

  it('posts analyze requests as multipart form data with the photo and its role', async () => {
    const image = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
    const promise = api.analyze(
      { mode: 'food_photo', description: 'Half portion', precise: 'true', mealType: undefined },
      [{ blob: image, role: 'food' }],
    );
    const req = http.expectOne('/api/analyze');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('mode')).toBe('food_photo');
    expect(body.get('description')).toBe('Half portion');
    expect(body.get('precise')).toBe('true');
    expect(body.has('mealType')).toBe(false);
    expect(body.has('image')).toBe(false);
    expect(body.get('imageRoles')).toBe('food');
    const files = body.getAll('images') as File[];
    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(Blob);
    expect(files[0]!.name).toBe('photo-1.jpg');
    req.flush({ analysisId: 'a1' } as AnalyzeResponse);
    await expect(promise).resolves.toMatchObject({ analysisId: 'a1' });
  });

  it('sends several photos in order with aligned roles', async () => {
    const food = new Blob(['food'], { type: 'image/jpeg' });
    const label = new Blob(['label'], { type: 'image/jpeg' });
    const promise = api.analyze(
      { mode: 'food_photo', previousAnalysisId: 'a0', imageRoles: 'label,label' },
      [
        { blob: food, role: 'food' },
        { blob: label, role: 'label' },
      ],
    );
    const req = http.expectOne('/api/analyze');
    const body = req.request.body as FormData;
    expect(body.getAll('imageRoles')).toEqual(['food,label']);
    const files = body.getAll('images') as File[];
    expect(files.map((file) => file.name)).toEqual(['photo-1.jpg', 'photo-2.jpg']);
    expect(files.map((file) => file.size)).toEqual([food.size, label.size]);
    expect(body.get('previousAnalysisId')).toBe('a0');
    req.flush({ analysisId: 'a3' } as AnalyzeResponse);
    await promise;
  });

  it('omits the image parts and roles for text analyses', async () => {
    const promise = api.analyze({ mode: 'text', description: 'Two eggs' });
    const req = http.expectOne('/api/analyze');
    const body = req.request.body as FormData;
    expect(body.has('image')).toBe(false);
    expect(body.has('images')).toBe(false);
    expect(body.has('imageRoles')).toBe(false);
    req.flush({ analysisId: 'a2' } as AnalyzeResponse);
    await promise;
  });

  it('logs in with a JSON body', async () => {
    const user: UserDto = { id: 'u1', email: 'me@example.com', name: null, role: 'member' };
    const promise = api.login({ email: 'me@example.com', password: 'secret123' });
    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'me@example.com', password: 'secret123' });
    req.flush(user);
    await expect(promise).resolves.toEqual(user);
  });

  it('resolves void for 204 responses and encodes ids', async () => {
    const promise = api.deleteEntry('a/b');
    const req = http.expectOne('/api/entries/a%2Fb');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects with the HTTP error on failure', async () => {
    const promise = api.getEntry('missing');
    http
      .expectOne('/api/entries/missing')
      .flush(
        { statusCode: 404, message: 'Entry not found' },
        { status: 404, statusText: 'Not Found' },
      );
    await expect(promise).rejects.toMatchObject({ status: 404 });
  });

  it('builds dashboard and export URLs', async () => {
    const promise = api.rangeDashboard('2026-09-01', '2026-09-28');
    const req = http.expectOne((r) => r.url === '/api/dashboard/range');
    expect(req.request.params.get('from')).toBe('2026-09-01');
    expect(req.request.params.get('to')).toBe('2026-09-28');
    req.flush({});
    await promise;
    expect(api.exportUrl('csv')).toBe('/api/export?format=csv');
    expect(api.photoThumbUrl('p1')).toBe('/api/photos/p1/thumb');
  });
});

describe('ApiService (my foods)', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists saved foods with an optional search', async () => {
    const all = api.listMyFoods();
    const plain = http.expectOne((r) => r.url === '/api/my-foods');
    expect(plain.request.method).toBe('GET');
    expect(plain.request.params.keys()).toEqual([]);
    plain.flush([]);
    await expect(all).resolves.toEqual([]);

    const search = api.listMyFoods({ q: 'ketchup' });
    const req = http.expectOne((r) => r.url === '/api/my-foods');
    expect(req.request.params.get('q')).toBe('ketchup');
    req.flush([]);
    await search;
  });

  it('creates, updates and deletes saved foods', async () => {
    const body = {
      name: 'Heinz tomato ketchup',
      basisUnit: 'g' as const,
      per100: { ...zeroNutrients(), calories: 110 },
      source: 'manual' as const,
    };
    const created = api.createMyFood(body);
    const post = http.expectOne('/api/my-foods');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual(body);
    post.flush({ id: 'f/1' });
    await created;

    const updated = api.updateMyFood('f/1', { name: 'Ketchup', applyToPast: true });
    const put = http.expectOne('/api/my-foods/f%2F1');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ name: 'Ketchup', applyToPast: true });
    put.flush({ food: { id: 'f/1' }, updatedItems: 2, updatedEntries: 1, updatedFavorites: 0 });
    await expect(updated).resolves.toMatchObject({ updatedItems: 2 });

    const removed = api.deleteMyFood('f/1');
    const del = http.expectOne('/api/my-foods/f%2F1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    await expect(removed).resolves.toBeUndefined();
  });

  it('loads, merges and dismisses merge suggestions', async () => {
    const loaded = api.foodMergeSuggestions();
    const get = http.expectOne('/api/my-foods/suggestions');
    expect(get.request.method).toBe('GET');
    get.flush({ suggestions: [] });
    await expect(loaded).resolves.toEqual({ suggestions: [] });

    const body = {
      key: 'tomato ketchup',
      names: ['Tomato ketchup'],
      name: 'Tomato ketchup',
      basisUnit: 'g' as const,
      per100: zeroNutrients(),
      applyToPast: true,
    };
    const merged = api.mergeFoods(body);
    const post = http.expectOne('/api/my-foods/merge');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual(body);
    post.flush({ food: { id: 'f1' }, updatedItems: 0, updatedEntries: 0, updatedFavorites: 0 });
    await merged;

    const dismissed = api.dismissFoodMerge({ key: 'tomato ketchup' });
    const dismiss = http.expectOne('/api/my-foods/suggestions/dismiss');
    expect(dismiss.request.method).toBe('POST');
    expect(dismiss.request.body).toEqual({ key: 'tomato ketchup' });
    dismiss.flush(null, { status: 204, statusText: 'No Content' });
    await expect(dismissed).resolves.toBeUndefined();
  });
});

describe('toHttpParams', () => {
  it('drops undefined, null and empty values', () => {
    const params = toHttpParams({ a: 1, b: undefined, c: null, d: '', e: false });
    expect(params.toString()).toBe('a=1&e=false');
  });
});
