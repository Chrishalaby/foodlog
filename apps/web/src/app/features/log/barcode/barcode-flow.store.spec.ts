import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  zeroNutrients,
  type BarcodeLookupResponse,
  type EntryDto,
  type FoodRenameRequest,
  type FoodRenameResponse,
  type LogProductRequest,
  type ProductDto,
  type UpsertProductRequest,
} from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { NetworkService } from '../../../core/network.service';
import { ToastService } from '../../../core/toast.service';
import { SessionScope } from '../../../core/session-scope';
import { BarcodeImageReader, type ImageScanResult } from './barcode-image';
import {
  BarcodeFlowStore,
  INVALID_BARCODE,
  LOOKUP_ERROR,
  PRODUCT_SAVED,
  SAME_BARCODE_IN_IMAGE,
} from './barcode-flow.store';
import {
  CODE_READER_UNAVAILABLE,
  NO_BARCODE_IN_PHOTO,
  NO_PRODUCT_IN_QR,
  PHOTO_UNREADABLE,
} from './scanner-copy';

const EAN = '5281234567896';

const PRODUCT: ProductDto = {
  id: 'product-1',
  barcode: EAN,
  name: 'Strawberry yogurt',
  brand: 'Khoury',
  aliases: [],
  unitName: null,
  unitGrams: null,
  basisUnit: 'g',
  per100: { ...zeroNutrients(), calories: 88, protein: 3.5, carbs: 13, fat: 2.5 },
  microsPer100: null,
  servingSizeG: 170,
  packSizeG: 170,
  source: 'openfoodfacts',
  imageUrl: null,
  missingNutrients: [],
  useCount: 0,
  lastUsedAt: null,
};

function entry(body: LogProductRequest): EntryDto {
  return {
    portion: null,
    id: 'entry-7',
    name: 'Khoury Strawberry yogurt',
    description: null,
    mealType: body.mealType,
    source: 'barcode',
    timestamp: body.timestamp,
    localDate: body.localDate,
    items: [],
    totals: { ...zeroNutrients(), calories: 150 },
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: body.timestamp,
    updatedAt: body.timestamp,
  };
}

const BODY: LogProductRequest = {
  servings: 1,
  timestamp: '2026-09-28T07:30:00.000Z',
  localDate: '2026-09-28',
  mealType: 'breakfast',
};

const UPSERT: UpsertProductRequest = {
  name: 'Strawberry yogurt',
  brand: 'Khoury',
  basisUnit: 'g',
  per100: PRODUCT.per100,
  servingSizeG: 170,
  packSizeG: 170,
  source: 'manual',
};

describe('BarcodeFlowStore', () => {
  const api = {
    lookupBarcode: vi.fn<(code: string, signal?: AbortSignal) => Promise<BarcodeLookupResponse>>(),
    upsertProduct: vi.fn<(code: string, body: UpsertProductRequest) => Promise<ProductDto>>(),
    logProduct: vi.fn<(id: string, body: LogProductRequest) => Promise<EntryDto>>(),
    deleteEntry: vi.fn<(id: string) => Promise<void>>(),
    renameFood: vi.fn<(body: FoodRenameRequest) => Promise<FoodRenameResponse>>(),
  };
  const online = signal(true);
  const images = { read: vi.fn<(file: Blob) => Promise<ImageScanResult>>() };
  let flow: BarcodeFlowStore;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    images.read.mockReset();
    online.set(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        BarcodeFlowStore,
        { provide: ApiService, useValue: api },
        { provide: NetworkService, useValue: { online } },
        { provide: BarcodeImageReader, useValue: images },
      ],
    });
    flow = TestBed.inject(BarcodeFlowStore);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => TestBed.inject(ToastService).clear());

  it('opens and closes the scanner', () => {
    flow.openScanner();
    expect(flow.scanning()).toBe(true);
    expect(flow.sheetOpen()).toBe(false);
    flow.closeScanner();
    expect(flow.step()).toEqual({ kind: 'idle' });
  });

  it('shows your product or the Open Food Facts result', async () => {
    api.lookupBarcode.mockResolvedValue({
      barcode: EAN,
      source: 'openfoodfacts',
      product: PRODUCT,
    });
    flow.openScanner();
    const pending = flow.lookup(EAN);
    expect(flow.step()).toEqual({ kind: 'lookup', barcode: EAN });
    expect(flow.sheetOpen()).toBe(true);
    await pending;
    expect(api.lookupBarcode).toHaveBeenCalledWith(EAN, expect.any(AbortSignal));
    expect(flow.step()).toEqual({ kind: 'found', barcode: EAN, product: PRODUCT });
    const events = TestBed.inject(DataEventsService);
    expect(events.products()).toBe(1);

    api.lookupBarcode.mockResolvedValue({ barcode: EAN, source: 'library', product: PRODUCT });
    await flow.lookup(EAN);
    expect(events.products()).toBe(1);
  });

  it('offers the fallbacks when nobody knows the product', async () => {
    api.lookupBarcode.mockResolvedValue({ barcode: EAN, source: null, product: null });
    await flow.lookup(EAN);
    expect(flow.step()).toEqual({ kind: 'missing', barcode: EAN });
    flow.enterManually();
    expect(flow.step()).toEqual({ kind: 'edit', barcode: EAN, product: null });
    flow.cancelEdit();
    expect(flow.step()).toEqual({ kind: 'missing', barcode: EAN });
  });

  it('aborts the lookup when the sheet is closed', async () => {
    let captured: AbortSignal | undefined;
    api.lookupBarcode.mockImplementation(
      (_code, signal) =>
        new Promise((_resolve, reject) => {
          captured = signal;
          signal?.addEventListener('abort', () =>
            reject(new DOMException('The request was aborted', 'AbortError')),
          );
        }),
    );
    const pending = flow.lookup(EAN);
    flow.close();
    await pending;
    expect(captured?.aborted).toBe(true);
    expect(flow.step()).toEqual({ kind: 'idle' });
  });

  it('reports offline and server failures with a retry', async () => {
    online.set(false);
    await flow.lookup(EAN);
    expect(flow.step()).toMatchObject({ kind: 'failed', offline: true });
    expect(api.lookupBarcode).not.toHaveBeenCalled();

    online.set(true);
    api.lookupBarcode.mockRejectedValueOnce(new HttpErrorResponse({ status: 400 }));
    flow.retry();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.step()).toMatchObject({ kind: 'failed', message: INVALID_BARCODE, offline: false });

    api.lookupBarcode.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 500,
        error: { statusCode: 500, message: 'Internal server error' },
      }),
    );
    await flow.lookup(EAN);
    expect(flow.step()).toMatchObject({ kind: 'failed', message: LOOKUP_ERROR });

    api.lookupBarcode.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    await flow.lookup(EAN);
    expect(flow.step()).toEqual({ kind: 'missing', barcode: EAN });
  });

  it('logs the product, notifies, offers undo and goes to Today', async () => {
    api.logProduct.mockImplementation(async (_id, body) => entry(body));
    api.deleteEntry.mockResolvedValue(undefined);
    api.lookupBarcode.mockResolvedValue({ barcode: EAN, source: 'library', product: PRODUCT });
    await flow.lookup(EAN);

    const logged = await flow.log(PRODUCT, BODY);
    expect(logged?.id).toBe('entry-7');
    expect(api.logProduct).toHaveBeenCalledWith('product-1', BODY);
    const events = TestBed.inject(DataEventsService);
    expect(events.entries()).toBe(1);
    expect(events.products()).toBe(1);
    expect(flow.step()).toEqual({ kind: 'idle' });
    expect(navigate).toHaveBeenCalledWith('/today');

    const toasts = TestBed.inject(ToastService);
    const toast = toasts.toasts().at(-1)!;
    expect(toast.message).toBe('Logged Khoury Strawberry yogurt · 150 kcal');
    expect(toast.actions.map((action) => action.label)).toEqual(['Undo', 'View']);
    toasts.runAction(toast.id, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.deleteEntry).toHaveBeenCalledWith('entry-7');
    expect(events.entries()).toBe(2);
  });

  it('keeps the sheet open and explains when logging fails', async () => {
    api.lookupBarcode.mockResolvedValue({ barcode: EAN, source: 'library', product: PRODUCT });
    api.logProduct.mockRejectedValue(new HttpErrorResponse({ status: 500 }));
    await flow.lookup(EAN);
    expect(await flow.log(PRODUCT, BODY)).toBeNull();
    expect(flow.step().kind).toBe('found');
    expect(flow.busy()).toBeNull();
    expect(TestBed.inject(ToastService).toasts().at(-1)?.kind).toBe('error');
  });

  it('saves corrected values and shows the updated product', async () => {
    const updated: ProductDto = {
      ...PRODUCT,
      source: 'manual',
      per100: { ...PRODUCT.per100, calories: 92 },
    };
    api.lookupBarcode.mockResolvedValue({ barcode: EAN, source: 'library', product: PRODUCT });
    api.upsertProduct.mockResolvedValue(updated);
    await flow.lookup(EAN);
    flow.editValues();
    expect(flow.step()).toEqual({ kind: 'edit', barcode: EAN, product: PRODUCT });

    const saving = flow.saveProduct(UPSERT);
    expect(flow.busy()).toBe('save');
    expect(await saving).toEqual(updated);
    expect(api.upsertProduct).toHaveBeenCalledWith(EAN, UPSERT);
    expect(flow.step()).toEqual({ kind: 'found', barcode: EAN, product: updated });
    expect(TestBed.inject(DataEventsService).products()).toBe(1);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(
      'Updated Khoury Strawberry yogurt',
    );
  });

  it('renames earlier logs when an existing product gets a new name', async () => {
    const renamed: ProductDto = { ...PRODUCT, name: 'Fraise yogurt', source: 'manual' };
    api.lookupBarcode.mockResolvedValue({ barcode: EAN, source: 'library', product: PRODUCT });
    api.upsertProduct.mockResolvedValue(renamed);
    api.renameFood.mockResolvedValue({ matchedEntries: 3, renamedEntries: 3, renamedItems: 0 });
    await flow.lookup(EAN);
    flow.editValues();

    expect(await flow.saveProduct({ ...UPSERT, name: 'Fraise yogurt' })).toEqual(renamed);

    expect(api.renameFood).toHaveBeenCalledWith({
      from: 'Khoury Strawberry yogurt',
      to: 'Khoury Fraise yogurt',
    });
    expect(flow.step()).toEqual({ kind: 'found', barcode: EAN, product: renamed });
    const events = TestBed.inject(DataEventsService);
    expect(events.products()).toBe(1);
    expect(events.entries()).toBe(1);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(
      'Updated Khoury Fraise yogurt',
    );
  });

  it('creates a product by hand and then offers to log it', async () => {
    api.lookupBarcode.mockResolvedValue({ barcode: EAN, source: null, product: null });
    api.upsertProduct.mockResolvedValue({ ...PRODUCT, source: 'manual' });
    await flow.lookup(EAN);
    flow.enterManually();
    await flow.saveProduct(UPSERT);
    expect(flow.step()).toMatchObject({ kind: 'found', barcode: EAN });
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(PRODUCT_SAVED);
  });

  it('closes the scanner and any product sheet when the session resets', async () => {
    api.lookupBarcode.mockResolvedValue({ barcode: EAN, source: 'library', product: PRODUCT });
    await flow.lookup(EAN);
    expect(flow.sheetOpen()).toBe(true);
    TestBed.inject(SessionScope).reset();
    expect(flow.step()).toEqual({ kind: 'idle' });

    flow.openScanner();
    TestBed.inject(SessionScope).reset();
    expect(flow.scanning()).toBe(false);
  });

  it('keeps the editor open with the error when saving fails', async () => {
    api.lookupBarcode.mockResolvedValue({ barcode: EAN, source: null, product: null });
    api.upsertProduct.mockRejectedValue(
      new HttpErrorResponse({
        status: 400,
        error: { statusCode: 400, message: ['name is too long'] },
      }),
    );
    await flow.lookup(EAN);
    flow.enterManually();
    expect(await flow.saveProduct(UPSERT)).toBeNull();
    expect(flow.step().kind).toBe('edit');
    expect(flow.saveError()).toBe('Name is too long.');
  });

  describe('codes from a gallery image', () => {
    const image = new Blob(['png'], { type: 'image/png' });

    async function missing(): Promise<void> {
      api.lookupBarcode.mockResolvedValueOnce({ barcode: EAN, source: null, product: null });
      await flow.lookup(EAN);
    }

    it('looks up the code found in the image', async () => {
      await missing();
      images.read.mockResolvedValueOnce({ kind: 'code', code: '9506000134352' });
      api.lookupBarcode.mockResolvedValueOnce({
        barcode: '9506000134352',
        source: 'library',
        product: { ...PRODUCT, barcode: '9506000134352' },
      });
      const pending = flow.lookupImage(image);
      expect(flow.imageBusy()).toBe(true);
      await pending;
      expect(images.read).toHaveBeenCalledWith(image);
      expect(api.lookupBarcode).toHaveBeenLastCalledWith('9506000134352', expect.any(AbortSignal));
      expect(flow.step()).toMatchObject({ kind: 'found', barcode: '9506000134352' });
      expect(flow.imageBusy()).toBe(false);
    });

    it('does not look up the same unknown barcode again', async () => {
      await missing();
      images.read.mockResolvedValueOnce({ kind: 'code', code: EAN });
      await flow.lookupImage(image);
      expect(api.lookupBarcode).toHaveBeenCalledTimes(1);
      expect(flow.step()).toEqual({ kind: 'missing', barcode: EAN });
      expect(flow.imageMessage()).toBe(SAME_BARCODE_IN_IMAGE);
      expect(flow.imageBusy()).toBe(false);
    });

    it('retries the lookup when the same barcode failed to load', async () => {
      api.lookupBarcode.mockRejectedValueOnce(new HttpErrorResponse({ status: 502 }));
      await flow.lookup(EAN);
      expect(flow.step().kind).toBe('failed');
      images.read.mockResolvedValueOnce({ kind: 'code', code: EAN });
      api.lookupBarcode.mockResolvedValueOnce({
        barcode: EAN,
        source: 'library',
        product: PRODUCT,
      });
      await flow.lookupImage(image);
      expect(api.lookupBarcode).toHaveBeenCalledTimes(2);
      expect(flow.step()).toMatchObject({ kind: 'found', barcode: EAN });
    });

    it('explains a code reader that could not load', async () => {
      await missing();
      images.read.mockResolvedValueOnce({ kind: 'reader' });
      await flow.lookupImage(image);
      expect(flow.imageMessage()).toBe(CODE_READER_UNAVAILABLE);
    });

    it('explains images without a product code and keeps the sheet', async () => {
      await missing();
      images.read.mockResolvedValueOnce({ kind: 'foreign' });
      await flow.lookupImage(image);
      expect(flow.imageMessage()).toBe(NO_PRODUCT_IN_QR);
      expect(flow.step()).toEqual({ kind: 'missing', barcode: EAN });

      images.read.mockResolvedValueOnce({ kind: 'none' });
      await flow.lookupImage(image);
      expect(flow.imageMessage()).toBe(NO_BARCODE_IN_PHOTO);

      images.read.mockResolvedValueOnce({ kind: 'unreadable' });
      await flow.lookupImage(image);
      expect(flow.imageMessage()).toBe(PHOTO_UNREADABLE);
      expect(api.lookupBarcode).toHaveBeenCalledTimes(1);

      flow.close();
      expect(flow.imageMessage()).toBeNull();
    });

    it('ignores the result when the sheet closed while reading and only runs from the fallbacks', async () => {
      await flow.lookupImage(image);
      expect(images.read).not.toHaveBeenCalled();

      await missing();
      let finish: (result: ImageScanResult) => void = () => undefined;
      images.read.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
      const pending = flow.lookupImage(image);
      flow.close();
      finish({ kind: 'code', code: EAN });
      await pending;
      expect(flow.step()).toEqual({ kind: 'idle' });
      expect(flow.imageBusy()).toBe(false);
      expect(api.lookupBarcode).toHaveBeenCalledTimes(1);
    });
  });
});
