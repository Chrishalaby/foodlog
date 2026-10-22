import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { UpsertProductRequest } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService } from '../../../shared/ui/confirm.service';
import { ProductLibrary } from './product-library';
import { makeFood, makeProduct } from '../../today/today-fixtures';

const YOGURT = makeProduct();

function request(overrides: Partial<UpsertProductRequest> = {}): UpsertProductRequest {
  return {
    name: YOGURT.name,
    brand: YOGURT.brand,
    basisUnit: 'g',
    per100: YOGURT.per100,
    servingSizeG: 170,
    packSizeG: 170,
    source: 'manual',
    ...overrides,
  };
}

describe('ProductLibrary', () => {
  let api: {
    listProducts: ReturnType<typeof vi.fn>;
    upsertProduct: ReturnType<typeof vi.fn>;
    deleteProduct: ReturnType<typeof vi.fn>;
    renameFood: ReturnType<typeof vi.fn>;
    hideFood: ReturnType<typeof vi.fn>;
    updateMyFood: ReturnType<typeof vi.fn>;
  };
  let confirm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    api = {
      listProducts: vi.fn().mockResolvedValue([YOGURT]),
      upsertProduct: vi.fn(async (_code: string, body: UpsertProductRequest) => ({
        ...YOGURT,
        name: body.name,
        brand: body.brand ?? null,
      })),
      deleteProduct: vi.fn().mockResolvedValue(undefined),
      renameFood: vi.fn().mockResolvedValue({ matchedEntries: 3, renamedEntries: 3 }),
      hideFood: vi.fn().mockResolvedValue({ names: [] }),
      updateMyFood: vi.fn(async (id: string, body: UpsertProductRequest) => ({
        food: { ...YOGURT, id, barcode: null, name: body.name, brand: body.brand ?? null },
        updatedItems: 0,
        updatedEntries: 0,
        updatedFavorites: 0,
      })),
    };
    confirm = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: { confirm } },
      ],
    });
  });

  afterEach(() => TestBed.inject(ToastService).clear());

  const lastToast = () => TestBed.inject(ToastService).toasts().at(-1);

  it('finds a product by id and returns null once it is gone', async () => {
    const library = TestBed.inject(ProductLibrary);
    expect(await library.find('product-1')).toEqual(YOGURT);
    expect(await library.find('product-9')).toBeNull();
  });

  it('saves a food without a barcode through My foods', async () => {
    const library = TestBed.inject(ProductLibrary);
    const saved = await library.save(
      { ...YOGURT, barcode: null },
      request({ name: 'Yaourt fraise', per100: { ...YOGURT.per100, calories: 90 } }),
    );
    expect(api.upsertProduct).not.toHaveBeenCalled();
    expect(api.updateMyFood).toHaveBeenCalledWith('product-1', {
      name: 'Yaourt fraise',
      brand: 'Khoury',
      basisUnit: 'g',
      per100: { ...YOGURT.per100, calories: 90 },
      servingSizeG: 170,
    });
    expect(saved.barcode).toBeNull();
    expect(lastToast()?.message).toBe('Updated Khoury Yaourt fraise');
  });

  it('saves a product and renames its earlier logs when its name changes', async () => {
    const library = TestBed.inject(ProductLibrary);
    const events = TestBed.inject(DataEventsService);
    await library.save(YOGURT, request({ name: 'Strawberry yogurt' }), 'Khoury Yaourt fraise');

    expect(api.upsertProduct).toHaveBeenCalledWith(
      YOGURT.barcode,
      request({ name: 'Strawberry yogurt' }),
    );
    expect(api.renameFood).toHaveBeenCalledWith({
      from: 'Khoury Yaourt fraise',
      to: 'Khoury Strawberry yogurt',
    });
    expect(events.products()).toBe(1);
    expect(events.entries()).toBe(1);
    expect(lastToast()?.message).toBe('Updated Khoury Strawberry yogurt');
  });

  it('does not rename logs when only the values or the letter case change', async () => {
    const library = TestBed.inject(ProductLibrary);
    await library.save(YOGURT, request({ servingSizeG: 125 }));
    await library.save(YOGURT, request({ name: 'yaourt  FRAISE' }), 'Khoury Yaourt fraise');
    expect(api.upsertProduct).toHaveBeenCalledTimes(2);
    expect(api.renameFood).not.toHaveBeenCalled();
  });

  it('keeps the saved product but says so when its logs could not be renamed', async () => {
    api.renameFood.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const library = TestBed.inject(ProductLibrary);
    const saved = await library.save(YOGURT, request({ brand: 'Candia' }));
    expect(saved.brand).toBe('Candia');
    expect(lastToast()?.kind).toBe('error');
    expect(lastToast()?.message).toBe(
      'Saved Candia Yaourt fraise, but earlier logs kept the name “Khoury Yaourt fraise”.',
    );
  });

  it('lets a failed save reach the editor without touching logs', async () => {
    api.upsertProduct.mockRejectedValueOnce(new HttpErrorResponse({ status: 400 }));
    const library = TestBed.inject(ProductLibrary);
    await expect(library.save(YOGURT, request({ name: 'Other' }))).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );
    expect(api.renameFood).not.toHaveBeenCalled();
    expect(TestBed.inject(DataEventsService).products()).toBe(0);
  });

  describe('remove', () => {
    const result = makeFood({
      key: 'product:product-1',
      kind: 'product',
      name: 'Khoury Yaourt fraise',
      productId: 'product-1',
    });

    it('deletes the product after confirming and hides its name so old logs do not return', async () => {
      const library = TestBed.inject(ProductLibrary);
      const events = TestBed.inject(DataEventsService);
      expect(await library.remove(result)).toBe(true);

      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Delete “Khoury Yaourt fraise” from your products?',
          tone: 'danger',
        }),
      );
      expect(api.deleteProduct).toHaveBeenCalledWith('product-1');
      expect(api.hideFood).toHaveBeenCalledWith({ name: 'Khoury Yaourt fraise' });
      expect(events.products()).toBe(1);
      expect(events.entries()).toBe(1);
      expect(lastToast()?.message).toBe('Deleted “Khoury Yaourt fraise”. Your logs are kept.');
    });

    it('does nothing when the confirmation is declined', async () => {
      confirm.mockResolvedValueOnce(false);
      const library = TestBed.inject(ProductLibrary);
      expect(await library.remove(result)).toBe(false);
      expect(api.deleteProduct).not.toHaveBeenCalled();
      expect(api.hideFood).not.toHaveBeenCalled();
    });

    it('treats a product that is already gone as deleted', async () => {
      api.deleteProduct.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
      const library = TestBed.inject(ProductLibrary);
      expect(await library.remove(result)).toBe(true);
      expect(api.hideFood).toHaveBeenCalled();
    });

    it('reports a failed delete and keeps the suggestion', async () => {
      api.deleteProduct.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      const library = TestBed.inject(ProductLibrary);
      expect(await library.remove(result)).toBe(false);
      expect(api.hideFood).not.toHaveBeenCalled();
      expect(lastToast()?.kind).toBe('error');
    });

    it('still reports the delete when hiding its old logs fails', async () => {
      api.hideFood.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      const library = TestBed.inject(ProductLibrary);
      expect(await library.remove(result)).toBe(true);
      expect(lastToast()?.message).toBe(
        'Deleted “Khoury Yaourt fraise”. Its past logs may still show up in suggestions.',
      );
    });

    it('ignores results that are not saved products', async () => {
      const library = TestBed.inject(ProductLibrary);
      expect(await library.remove(makeFood({ key: 'meal:1', kind: 'meal' }))).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    });
  });
});
