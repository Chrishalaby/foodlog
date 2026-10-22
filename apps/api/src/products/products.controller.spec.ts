import type { EntryDto } from '@food/shared';
import type { AuthUser } from '../auth/auth.types.js';
import type { ProductLogService } from './product-log.service.js';
import {
  BARCODE_LOOKUP_THROTTLE,
  ProductsController,
} from './products.controller.js';
import type { LogProductDto } from './products.dto.js';
import type { ProductsService } from './products.service.js';

const USER = {
  id: '019a0000-0000-7000-8000-000000000001',
  email: 'owner@example.com',
} as AuthUser;
const PRODUCT_ID = '019a0000-0000-7000-8000-0000000000d1';

function setup() {
  const products = {
    lookup: vi.fn(),
    upsert: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
  };
  const productLog = {
    log: vi.fn().mockResolvedValue({ id: 'entry' } as EntryDto),
  };
  const controller = new ProductsController(
    products as unknown as ProductsService,
    productLog as unknown as ProductLogService,
  );
  return { controller, products, productLog };
}

function logBody(overrides: Partial<LogProductDto> = {}): LogProductDto {
  return {
    timestamp: '2026-09-28T08:15:00.000+03:00',
    localDate: '2026-09-28',
    mealType: 'breakfast',
    ...overrides,
  };
}

describe('ProductsController', () => {
  it('limits barcode lookups per client', () => {
    const lookup = Object.getOwnPropertyDescriptor(
      ProductsController.prototype,
      'lookup',
    )?.value as object;

    expect(BARCODE_LOOKUP_THROTTLE).toEqual({
      long: { limit: 60, ttl: 60_000 },
    });
    expect(Reflect.getMetadata('THROTTLER:LIMITlong', lookup)).toBe(60);
    expect(Reflect.getMetadata('THROTTLER:TTLlong', lookup)).toBe(60_000);
  });

  it('logs one serving by default', async () => {
    const { controller, productLog } = setup();

    await controller.log(USER, PRODUCT_ID, logBody());

    expect(productLog.log).toHaveBeenCalledWith(USER.id, PRODUCT_ID, {
      amount: { servings: 1 },
      timestamp: '2026-09-28T08:15:00.000+03:00',
      localDate: '2026-09-28',
      mealType: 'breakfast',
    });
  });

  it('logs grams or servings as sent', async () => {
    const { controller, productLog } = setup();

    await controller.log(USER, PRODUCT_ID, logBody({ grams: 80 }));
    await controller.log(USER, PRODUCT_ID, logBody({ servings: 2 }));

    expect(productLog.log.mock.calls.map(([, , request]) => request)).toEqual([
      expect.objectContaining({ amount: { grams: 80 } }),
      expect.objectContaining({ amount: { servings: 2 } }),
    ]);
  });

  it('passes the analysis, photo and description of a label scan through', async () => {
    const { controller, productLog } = setup();

    await controller.log(
      USER,
      PRODUCT_ID,
      logBody({
        grams: 40,
        analysisId: '019a0000-0000-7000-8000-0000000000a1',
        photoId: '019a0000-0000-7000-8000-0000000000f1',
        description: '1 serving',
      }),
    );

    expect(productLog.log).toHaveBeenCalledWith(USER.id, PRODUCT_ID, {
      amount: { grams: 40 },
      timestamp: '2026-09-28T08:15:00.000+03:00',
      localDate: '2026-09-28',
      mealType: 'breakfast',
      analysisId: '019a0000-0000-7000-8000-0000000000a1',
      photoId: '019a0000-0000-7000-8000-0000000000f1',
      description: '1 serving',
    });
  });

  it('scopes every call to the current user', async () => {
    const { controller, products } = setup();

    await controller.list(USER);
    await controller.lookup(USER, '5280001234566');
    await controller.remove(USER, PRODUCT_ID);

    expect(products.list).toHaveBeenCalledWith(USER.id);
    expect(products.lookup).toHaveBeenCalledWith(USER.id, '5280001234566');
    expect(products.remove).toHaveBeenCalledWith(USER.id, PRODUCT_ID);
  });
});
