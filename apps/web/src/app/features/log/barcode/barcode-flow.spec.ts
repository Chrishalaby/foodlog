import { Component, inject } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  zeroNutrients,
  type BarcodeLookupResponse,
  type EntryDto,
  type LogProductRequest,
  type ProductDto,
  type UpsertProductRequest,
} from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { CaptureService } from '../../../core/capture.service';
import { ToastService } from '../../../core/toast.service';
import { LogStore } from '../log.store';
import { installDialogShim } from '../testing/dialog-shim';
import { BarcodeFlow } from './barcode-flow';
import { BarcodeFlowStore } from './barcode-flow.store';
import { BarcodeImageReader, type ImageScanResult } from './barcode-image';
import { CAMERA_OPENER } from './camera';

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
  per100: { ...zeroNutrients(), calories: 88, protein: 3.5, carbs: 13, sugar: 12, fat: 2.5 },
  microsPer100: null,
  servingSizeG: 170,
  packSizeG: 170,
  source: 'openfoodfacts',
  imageUrl: 'https://images.openfoodfacts.org/images/products/528/123/456/7896/front_en.3.400.jpg',
  missingNutrients: [],
  useCount: 0,
  lastUsedAt: null,
};

@Component({
  imports: [BarcodeFlow],
  providers: [LogStore, BarcodeFlowStore],
  template: `<app-barcode-flow />`,
})
class Host {
  readonly flow = inject(BarcodeFlowStore);
  readonly log = inject(LogStore);
}

const text = (el: Element | null | undefined): string =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

const buttonWith = (el: HTMLElement, label: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    text(button).includes(label),
  )!;

function type(input: HTMLInputElement, value: string): void {
  input.dispatchEvent(new Event('focus'));
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}

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
    totals: { ...zeroNutrients(), calories: 224 },
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: body.timestamp,
    updatedAt: body.timestamp,
  };
}

describe('BarcodeFlow product sheet', () => {
  const api = {
    lookupBarcode: vi.fn<(code: string, signal?: AbortSignal) => Promise<BarcodeLookupResponse>>(),
    upsertProduct: vi.fn<(code: string, body: UpsertProductRequest) => Promise<ProductDto>>(),
    logProduct: vi.fn<(id: string, body: LogProductRequest) => Promise<EntryDto>>(),
    deleteEntry: vi.fn(),
    getProfile: vi.fn(() => new Promise(() => undefined)),
  };
  const images = { read: vi.fn<(file: Blob) => Promise<ImageScanResult>>() };
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    Object.values(api).forEach((mock) => mock.mockClear());
    images.read.mockReset();
    api.lookupBarcode.mockReset();
    api.upsertProduct.mockReset();
    api.logProduct.mockReset();
    api.logProduct.mockImplementation(async (_id, body) => entry(body));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: CAMERA_OPENER, useValue: () => new Promise<MediaStream>(() => undefined) },
        { provide: BarcodeImageReader, useValue: images },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  async function lookup(
    response: BarcodeLookupResponse,
  ): Promise<{ fixture: ComponentFixture<Host>; el: HTMLElement; host: Host }> {
    api.lookupBarcode.mockResolvedValue(response);
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    await fixture.componentInstance.flow.lookup(response.barcode);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
  }

  it('shows an Open Food Facts product with a warning and logs a chosen portion', async () => {
    const { fixture, el } = await lookup({
      barcode: EAN,
      source: 'openfoodfacts',
      product: PRODUCT,
    });
    const dialog = el.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-label')).toBe('Log Khoury Strawberry yogurt');
    expect(text(el.querySelector('h2'))).toBe('Khoury Strawberry yogurt');
    expect(el.textContent).toContain('5 281234 567896');
    expect(el.textContent).toContain('Open Food Facts — check the values');
    expect(el.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(el.textContent).toContain('88 kcal · P 3.5 · C 13 · F 2.5');

    const grams = el.querySelector<HTMLInputElement>('input[aria-label="Grams"]')!;
    expect(grams.value).toBe('170');
    expect(text(buttonWith(el, 'Log ·'))).toBe('Log · 150 kcal');
    expect(
      Array.from(el.querySelectorAll('[aria-label="Quick amounts"] button')).map(text),
    ).toEqual(['1 serving 170 g', '½ pack 85 g', '100 g']);

    buttonWith(el, '½ pack').click();
    await fixture.whenStable();
    expect(grams.value).toBe('85');
    expect(text(buttonWith(el, 'Log ·'))).toBe('Log · 75 kcal');
    expect(buttonWith(el, '½ pack').getAttribute('aria-pressed')).toBe('true');

    el.querySelector<HTMLButtonElement>('button[aria-label="More servings"]')!.click();
    await fixture.whenStable();
    expect(text(el.querySelector('output'))).toBe('1 serving');
    el.querySelector<HTMLButtonElement>('button[aria-label="More servings"]')!.click();
    await fixture.whenStable();
    expect(text(el.querySelector('output'))).toBe('1½ servings');
    expect(grams.value).toBe('255');
    expect(text(buttonWith(el, 'Log ·'))).toBe('Log · 224 kcal');

    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    expect(api.logProduct).toHaveBeenCalledWith(
      'product-1',
      expect.objectContaining({
        servings: 1.5,
        localDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    expect(api.logProduct.mock.calls[0]![1].grams).toBeUndefined();
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/today');
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('logs typed grams and shows the full nutrition table on demand', async () => {
    const { fixture, el } = await lookup({
      barcode: EAN,
      source: 'library',
      product: { ...PRODUCT, source: 'label', imageUrl: null },
    });
    expect(el.textContent).toContain('Your product');
    expect(el.querySelector('img')).toBeNull();
    type(el.querySelector<HTMLInputElement>('input[aria-label="Grams"]')!, '200');
    await fixture.whenStable();
    expect(text(buttonWith(el, 'Log ·'))).toBe('Log · 176 kcal');

    const toggle = el.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const rows = Array.from(el.querySelectorAll('tbody tr')).map(text);
    expect(rows[0]).toBe('Energy 88 kcal 176 kcal');
    expect(rows).toContain('of which sugars 12 g 24 g');
    expect(el.textContent).toContain('Serving 170 g · Pack 170 g');

    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    expect(api.logProduct.mock.calls[0]![1]).toMatchObject({ grams: 200 });
  });

  it('shows printed vitamins per 100 g and for the chosen amount in the nutrition table', async () => {
    const { fixture, el } = await lookup({
      barcode: EAN,
      source: 'library',
      product: { ...PRODUCT, microsPer100: { calcium: 120, vitaminD: 0.75 } },
    });
    type(el.querySelector<HTMLInputElement>('input[aria-label="Grams"]')!, '200');
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
    await fixture.whenStable();
    const facts = el.querySelector('[data-micro-facts]')!;
    expect(text(facts.querySelector('th[scope="colgroup"]'))).toBe('Vitamins & minerals');
    const cells = Array.from(facts.querySelectorAll('tr'))
      .slice(1)
      .map((row) => Array.from(row.querySelectorAll('th, td')).map(text));
    expect(cells).toEqual([
      ['Vitamin D', '0.8 µg', '1.5 µg'],
      ['Calcium', '120 mg', '240 mg'],
    ]);
  });

  it('leaves the vitamins section out for a product without them', async () => {
    const { fixture, el } = await lookup({ barcode: EAN, source: 'library', product: PRODUCT });
    el.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('[data-micro-facts]')).toBeNull();
  });

  it('names the nutrients Open Food Facts is missing and opens the editor from the note', async () => {
    const { fixture, el } = await lookup({
      barcode: EAN,
      source: 'openfoodfacts',
      product: { ...PRODUCT, missingNutrients: ['sodium', 'fiber'] },
    });
    const note = el.querySelector<HTMLElement>('[role="note"]')!;
    expect(text(note)).toContain('Open Food Facts is missing fiber and sodium');
    expect(text(note)).toContain('Counted as 0. Check the label to fill them in.');
    expect(el.textContent).not.toContain('Open Food Facts — check the values');

    api.upsertProduct.mockImplementation(async (_code, body) => ({
      ...PRODUCT,
      ...body,
      brand: body.brand ?? null,
      servingSizeG: body.servingSizeG ?? null,
      packSizeG: body.packSizeG ?? null,
      missingNutrients: [],
    }));
    buttonWith(note, 'Edit values').click();
    await fixture.whenStable();
    expect(text(el.querySelector('h2'))).toBe('Edit values');
    const hints = text(el.querySelector('ul[id$="-hints"]'));
    expect(hints).toContain('divide it by 4.184');
    expect(hints).toContain('add the fibre to the carbohydrate value');
    expect(hints).toContain('multiply the grams of salt by 400');
    type(el.querySelector<HTMLInputElement>('input[id$="-fiber"]')!, '0.4');
    await fixture.whenStable();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    expect(api.upsertProduct.mock.calls[0]![1].per100.fiber).toBe(0.4);
    expect(el.textContent).toContain('Your product');
    expect(el.querySelector('[role="note"]')).toBeNull();
  });

  it('uses the singular for a single missing nutrient on your own product', async () => {
    const { el } = await lookup({
      barcode: EAN,
      source: 'library',
      product: { ...PRODUCT, source: 'label', missingNutrients: ['satFat'] },
    });
    expect(text(el.querySelector('[role="note"]'))).toContain(
      'Missing saturated fat Counted as 0. Check the label to fill it in.',
    );
  });

  it('corrects values inline and saves them as your own product', async () => {
    const { fixture, el } = await lookup({
      barcode: EAN,
      source: 'openfoodfacts',
      product: PRODUCT,
    });
    api.upsertProduct.mockImplementation(async (_code, body) => ({
      ...PRODUCT,
      ...body,
      brand: body.brand ?? null,
      servingSizeG: body.servingSizeG ?? null,
      packSizeG: body.packSizeG ?? null,
    }));
    buttonWith(el, 'Edit values').click();
    await fixture.whenStable();
    expect(text(el.querySelector('h2'))).toBe('Edit values');
    const energy = el.querySelector<HTMLInputElement>('input[id$="-calories"]')!;
    expect(energy.value).toBe('88');
    type(energy, '92');
    await fixture.whenStable();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    expect(api.upsertProduct).toHaveBeenCalledWith(
      EAN,
      expect.objectContaining({
        name: 'Strawberry yogurt',
        brand: 'Khoury',
        source: 'manual',
        per100: expect.objectContaining({ calories: 92, protein: 3.5 }),
        servingSizeG: 170,
      }),
    );
    expect(el.textContent).toContain('Your product');
    expect(text(buttonWith(el, 'Log ·'))).toBe('Log · 156 kcal');
  });

  it('offers the label scan, a description or manual values for unknown products', async () => {
    const { fixture, el, host } = await lookup({ barcode: EAN, source: null, product: null });
    expect(text(el.querySelector('h2'))).toBe("We don't know this product yet");
    expect(el.textContent).toContain('5 281234 567896');
    const capture = TestBed.inject(CaptureService);
    const labelScan = vi.spyOn(capture, 'requestLabelScan').mockImplementation(() => undefined);

    buttonWith(el, 'Scan the nutrition label').click();
    await fixture.whenStable();
    expect(labelScan).toHaveBeenCalledWith(EAN);
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(host.flow.step()).toEqual({ kind: 'idle' });

    await host.flow.lookup(EAN);
    await fixture.whenStable();
    buttonWith(el, 'Describe it instead').click();
    await fixture.whenStable();
    expect(host.log.phase()).toBe('compose');
    expect(host.log.mode()).toBe('text');
    expect(host.log.barcode()).toBe(EAN);
    expect(host.flow.step()).toEqual({ kind: 'idle' });
  });

  it('reads another code from a gallery image in the unknown-product sheet', async () => {
    const { fixture, el } = await lookup({ barcode: EAN, source: null, product: null });
    const gallery = el.querySelector<HTMLInputElement>('app-product-missing input[type="file"]')!;
    expect(gallery.hasAttribute('capture')).toBe(false);
    const click = vi.spyOn(gallery, 'click').mockImplementation(() => undefined);
    buttonWith(el, 'Choose from gallery').click();
    expect(click).toHaveBeenCalled();

    const choose = (file: File): void => {
      Object.defineProperty(gallery, 'files', {
        configurable: true,
        value: { item: (index: number) => (index === 0 ? file : null), length: 1 },
      });
      gallery.dispatchEvent(new Event('change'));
    };
    images.read.mockResolvedValueOnce({ kind: 'foreign' });
    choose(new File(['x'], 'menu.png', { type: 'image/png' }));
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('app-product-missing [role="alert"]')?.textContent).toContain(
      'No product code in this QR',
    );

    images.read.mockResolvedValueOnce({ kind: 'code', code: '9506000134352' });
    api.lookupBarcode.mockResolvedValue({
      barcode: '9506000134352',
      source: 'library',
      product: { ...PRODUCT, barcode: '9506000134352' },
    });
    const file = new File(['x'], 'qr.png', { type: 'image/png' });
    choose(file);
    await fixture.whenStable();
    await fixture.whenStable();
    expect(images.read).toHaveBeenLastCalledWith(file);
    expect(api.lookupBarcode).toHaveBeenLastCalledWith('9506000134352', expect.any(AbortSignal));
    expect(text(el.querySelector('h2'))).toBe('Khoury Strawberry yogurt');
  });

  it('adds an unknown product by hand, then shows it ready to log', async () => {
    const { fixture, el } = await lookup({ barcode: EAN, source: null, product: null });
    api.upsertProduct.mockImplementation(async (_code, body) => ({
      ...PRODUCT,
      ...body,
      brand: body.brand ?? null,
      servingSizeG: body.servingSizeG ?? null,
      packSizeG: body.packSizeG ?? null,
    }));
    buttonWith(el, 'Enter values manually').click();
    await fixture.whenStable();
    expect(text(el.querySelector('h2'))).toBe('Add this product');

    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Give the product a name.');
    expect(api.upsertProduct).not.toHaveBeenCalled();

    const name = el.querySelector<HTMLInputElement>('input[id$="-name"]')!;
    name.value = 'Zaatar manakish';
    name.dispatchEvent(new Event('input'));
    type(el.querySelector<HTMLInputElement>('input[id$="-calories"]')!, '310');
    type(el.querySelector<HTMLInputElement>('input[id$="-servingSizeG"]')!, '120');
    await fixture.whenStable();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    expect(api.upsertProduct).toHaveBeenCalledWith(
      EAN,
      expect.objectContaining({
        name: 'Zaatar manakish',
        brand: null,
        source: 'manual',
        servingSizeG: 120,
        packSizeG: null,
      }),
    );
    expect(text(el.querySelector('h2'))).toBe('Zaatar manakish');
    expect(text(buttonWith(el, 'Log ·'))).toBe('Log · 372 kcal');
  });

  it('shows a retry when the lookup fails', async () => {
    api.lookupBarcode.mockRejectedValueOnce(new Error('Server exploded'));
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    await fixture.componentInstance.flow.lookup(EAN);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('h2'))).toBe("Couldn't look it up");
    expect(el.textContent).toContain('Server exploded');
    api.lookupBarcode.mockResolvedValue({ barcode: EAN, source: 'library', product: PRODUCT });
    buttonWith(el, 'Try again').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    expect(text(el.querySelector('h2'))).toBe('Khoury Strawberry yogurt');
  });

  it('renders the scanner while scanning and closes the sheet when the log leaves idle', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const { flow, log } = fixture.componentInstance;
    flow.openScanner();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-barcode-scanner')).not.toBeNull();
    expect(el.querySelector('dialog.scanner')?.hasAttribute('open')).toBe(true);

    log.startManual();
    await fixture.whenStable();
    expect(flow.step()).toEqual({ kind: 'idle' });
    expect(el.querySelector('app-barcode-scanner')).toBeNull();
  });
});
