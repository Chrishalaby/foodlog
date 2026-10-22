import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CaptureService, LOG_PATH, SCAN_PATH, SEARCH_PATH } from './capture.service';
import { SessionScope } from './session-scope';

function fileInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  return input;
}

function selectFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: { item: (index: number) => files[index] ?? null, length: files.length },
  });
  input.dispatchEvent(new Event('change'));
}

function selectFile(input: HTMLInputElement, file: File): void {
  selectFiles(input, [file]);
}

const image = (name: string): File => new File(['x'], name, { type: 'image/jpeg' });

@Component({ template: 'page' })
class Page {}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

describe('CaptureService', () => {
  let capture: CaptureService;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    capture = TestBed.inject(CaptureService);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  it('opens the camera input and stores the chosen file with the requested mode', () => {
    const camera = fileInput();
    const library = fileInput();
    const click = vi.spyOn(camera, 'click').mockImplementation(() => undefined);
    capture.attachInputs({ camera, library });

    capture.requestCamera('nutrition_label');
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(['x'], 'label.jpg', { type: 'image/jpeg' });
    selectFile(camera, file);

    expect(capture.pending()).toEqual({ file, mode: 'nutrition_label', source: 'camera' });
    expect(navigate).toHaveBeenCalledWith(LOG_PATH);
    expect(capture.consume()).toEqual({ file, mode: 'nutrition_label', source: 'camera' });
    expect(capture.pending()).toBeNull();
  });

  it('uses the library input for library requests', () => {
    const camera = fileInput();
    const library = fileInput();
    const click = vi.spyOn(library, 'click').mockImplementation(() => undefined);
    capture.attachInputs({ camera, library });
    capture.requestLibrary();
    expect(click).toHaveBeenCalledTimes(1);
    const file = new File(['x'], 'meal.jpg', { type: 'image/jpeg' });
    selectFile(library, file);
    expect(capture.pending()).toEqual({ file, mode: 'food_photo', source: 'library' });
  });

  it('starts a text capture without a file', () => {
    capture.startText();
    expect(capture.pending()).toEqual({ file: null, mode: 'text', source: 'text' });
    expect(navigate).toHaveBeenCalledWith(LOG_PATH);
  });

  it('falls back to the log page when no inputs are attached', () => {
    const camera = fileInput();
    const detach = capture.attachInputs({ camera, library: fileInput() });
    detach();
    capture.requestCamera();
    expect(capture.pending()).toEqual({ file: null, mode: 'food_photo', source: 'camera' });
  });

  it('carries an optional description with text and photo captures', () => {
    capture.startText('  Khoury strawberry yogurt  ');
    expect(capture.consume()).toEqual({
      file: null,
      mode: 'text',
      source: 'text',
      description: 'Khoury strawberry yogurt',
    });

    const camera = fileInput();
    vi.spyOn(camera, 'click').mockImplementation(() => undefined);
    capture.attachInputs({ camera, library: fileInput() });
    capture.requestCamera('nutrition_label', 'granola');
    const file = new File(['x'], 'label.jpg', { type: 'image/jpeg' });
    selectFile(camera, file);
    expect(capture.consume()).toEqual({
      file,
      mode: 'nutrition_label',
      source: 'camera',
      description: 'granola',
    });

    capture.requestCamera('food_photo');
    selectFile(camera, file);
    expect(capture.consume()).toEqual({ file, mode: 'food_photo', source: 'camera' });
  });

  it('drops blank descriptions', () => {
    capture.startText('   ');
    expect(capture.consume()).toEqual({ file: null, mode: 'text', source: 'text' });
  });

  it('opens the barcode scanner with a fresh request each time', () => {
    capture.requestBarcode();
    expect(navigate).toHaveBeenCalledWith(SCAN_PATH, { replaceUrl: false });
    expect(SCAN_PATH).toBe('/log?scan=1');
    const first = capture.scanRequest();
    expect(first).toEqual({ id: expect.any(Number) });

    capture.requestBarcode();
    const second = capture.consumeScan();
    expect(second?.id).not.toBe(first?.id);
    expect(capture.scanRequest()).toBeNull();
    expect(capture.consumeScan()).toBeNull();
  });

  it('replaces the log page entry so back does not land on the same page twice', () => {
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/log?search=1');
    capture.requestBarcode();
    expect(navigate).toHaveBeenCalledWith(SCAN_PATH, { replaceUrl: true });
  });

  it('opens the camera for a label scan and carries the barcode with the photo', () => {
    const camera = fileInput();
    const click = vi.spyOn(camera, 'click').mockImplementation(() => undefined);
    capture.attachInputs({ camera, library: fileInput() });

    capture.requestLabelScan('5281234567896');
    expect(click).toHaveBeenCalledTimes(1);
    const file = new File(['x'], 'label.jpg', { type: 'image/jpeg' });
    selectFile(camera, file);
    expect(capture.consume()).toEqual({
      file,
      mode: 'nutrition_label',
      source: 'camera',
      barcode: '5281234567896',
    });

    capture.requestCamera('food_photo');
    selectFile(camera, file);
    expect(capture.consume()).toEqual({ file, mode: 'food_photo', source: 'camera' });
  });

  it('starts a label compose with the barcode when no inputs are attached', () => {
    capture.requestLabelScan('5281234567896');
    expect(capture.consume()).toEqual({
      file: null,
      mode: 'nutrition_label',
      source: 'camera',
      barcode: '5281234567896',
    });
    capture.requestLabelScan('not-a-code');
    expect(capture.consume()).toEqual({ file: null, mode: 'nutrition_label', source: 'camera' });
  });

  it('opens the food search with an optional query', () => {
    capture.openSearch();
    expect(navigate).toHaveBeenCalledWith(SEARCH_PATH);
    const first = capture.searchRequest();
    expect(first).toEqual({ id: expect.any(Number), query: null });

    capture.openSearch('  yogurt ');
    const second = capture.consumeSearch();
    expect(second?.query).toBe('yogurt');
    expect(second?.id).not.toBe(first?.id);
    expect(capture.searchRequest()).toBeNull();
    expect(capture.consumeSearch()).toBeNull();
  });

  describe('adding photos to the current meal', () => {
    it('hands extra photos to the open draft without starting a new capture', () => {
      const camera = fileInput();
      const library = fileInput();
      const click = vi.spyOn(camera, 'click').mockImplementation(() => undefined);
      capture.attachInputs({ camera, library });

      capture.requestAddPhoto('camera', { role: 'label' });
      expect(click).toHaveBeenCalledTimes(1);
      expect(camera.multiple).toBe(false);
      const file = image('label.jpg');
      selectFile(camera, file);

      expect(capture.pending()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      const addition = capture.consumeAddition();
      expect(addition).toEqual({
        id: expect.any(Number),
        files: [file],
        skipped: 0,
        source: 'camera',
        role: 'label',
      });
      expect(capture.addition()).toBeNull();
      expect(capture.consumeAddition()).toBeNull();
    });

    it('lets the library pick several photos up to the free slots', () => {
      const library = fileInput();
      vi.spyOn(library, 'click').mockImplementation(() => undefined);
      capture.attachInputs({ camera: fileInput(), library });

      capture.requestAddPhoto('library', { max: 2 });
      expect(library.multiple).toBe(true);
      const [a, b, c] = [image('a.jpg'), image('b.jpg'), image('c.jpg')];
      selectFiles(library, [a, b, c]);
      expect(capture.addition()).toMatchObject({
        files: [a, b],
        skipped: 1,
        source: 'library',
        role: null,
      });
      expect(library.multiple).toBe(false);

      capture.requestAddPhoto('library', { max: 99 });
      selectFiles(library, [a, b, c, image('d.jpg')]);
      expect(capture.consumeAddition()).toMatchObject({ files: [a, b, c], skipped: 1 });
    });

    it('goes back to normal captures after an addition or a new request', () => {
      const camera = fileInput();
      const library = fileInput();
      vi.spyOn(camera, 'click').mockImplementation(() => undefined);
      vi.spyOn(library, 'click').mockImplementation(() => undefined);
      capture.attachInputs({ camera, library });

      capture.requestAddPhoto('library', { max: 3 });
      capture.requestLibrary('nutrition_label');
      expect(library.multiple).toBe(false);
      const file = image('label.jpg');
      selectFile(library, file);
      expect(capture.addition()).toBeNull();
      expect(capture.consume()).toEqual({ file, mode: 'nutrition_label', source: 'library' });

      capture.requestAddPhoto('camera');
      selectFile(camera, file);
      expect(capture.consumeAddition()?.files).toEqual([file]);
      capture.requestCamera();
      selectFile(camera, file);
      expect(capture.addition()).toBeNull();
      expect(capture.consume()).toEqual({ file, mode: 'food_photo', source: 'camera' });
    });

    it('ignores an empty selection and requests without attached inputs', () => {
      const camera = fileInput();
      vi.spyOn(camera, 'click').mockImplementation(() => undefined);
      const detach = capture.attachInputs({ camera, library: fileInput() });
      capture.requestAddPhoto('camera');
      selectFiles(camera, []);
      expect(capture.addition()).toBeNull();
      expect(capture.pending()).toBeNull();

      detach();
      capture.requestAddPhoto('camera');
      expect(capture.addition()).toBeNull();
      expect(capture.pending()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('drops a waiting addition when the session resets', () => {
      const camera = fileInput();
      vi.spyOn(camera, 'click').mockImplementation(() => undefined);
      capture.attachInputs({ camera, library: fileInput() });
      capture.requestAddPhoto('camera');
      selectFile(camera, image('a.jpg'));
      capture.requestAddPhoto('camera');
      TestBed.inject(SessionScope).reset();
      expect(capture.addition()).toBeNull();
      const file = image('b.jpg');
      selectFile(camera, file);
      expect(capture.addition()).toBeNull();
      expect(capture.pending()).toEqual({ file, mode: 'food_photo', source: 'camera' });
    });
  });

  describe('when the navigation to the log page does not land', () => {
    beforeEach(() => {
      vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/entries/abc');
    });

    it('drops a text capture that was refused', async () => {
      navigate.mockResolvedValueOnce(false);
      capture.startText('pasta');
      await flush();
      expect(capture.pending()).toBeNull();
    });

    it('drops a food search that was refused', async () => {
      navigate.mockResolvedValueOnce(false);
      capture.openSearch('yogurt');
      await flush();
      expect(capture.searchRequest()).toBeNull();
    });

    it('drops a barcode scan that was refused', async () => {
      navigate.mockResolvedValueOnce(false);
      capture.requestBarcode();
      await flush();
      expect(capture.scanRequest()).toBeNull();
    });

    it('drops a photo whose navigation failed outright', async () => {
      navigate.mockRejectedValueOnce(new Error('chunk'));
      const camera = fileInput();
      capture.attachInputs({ camera, library: fileInput() });
      vi.spyOn(camera, 'click').mockImplementation(() => undefined);
      capture.requestCamera();
      selectFile(camera, image('meal.jpg'));
      await flush();
      expect(capture.pending()).toBeNull();
    });

    it('never lets an older failed navigation drop a newer request', async () => {
      const first = deferred<boolean>();
      navigate.mockReturnValueOnce(first.promise).mockResolvedValueOnce(true);
      capture.startText('a');
      capture.startText('b');
      first.resolve(false);
      await flush();
      expect(capture.pending()?.description).toBe('b');

      const search = deferred<boolean>();
      navigate.mockReturnValueOnce(search.promise).mockResolvedValueOnce(true);
      capture.openSearch('old');
      capture.openSearch('new');
      const latest = capture.searchRequest();
      search.resolve(false);
      await flush();
      expect(capture.searchRequest()).toEqual(latest);
    });
  });

  it('keeps requests the open log page will pick up even when the router skips the navigation', async () => {
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/log?search=1');
    navigate.mockResolvedValue(false);
    capture.openSearch('yogurt');
    capture.startText('toast');
    capture.requestBarcode();
    await flush();
    expect(capture.searchRequest()?.query).toBe('yogurt');
    expect(capture.pending()?.description).toBe('toast');
    expect(capture.scanRequest()).not.toBeNull();
  });

  it('keeps requests once the navigation lands', async () => {
    capture.openSearch('yogurt');
    capture.startText('toast');
    await flush();
    expect(capture.searchRequest()?.query).toBe('yogurt');
    expect(capture.pending()?.description).toBe('toast');
  });

  it('drops a search when leaving an edit is cancelled', async () => {
    navigate.mockRestore();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'entries/:id', component: Page, canDeactivate: [() => false] },
          { path: 'log', component: Page },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create('/entries/abc');
    const service = TestBed.inject(CaptureService);
    service.openSearch('yogurt');
    await harness.fixture.whenStable();
    await flush();
    expect(TestBed.inject(Router).url).toBe('/entries/abc');
    expect(service.searchRequest()).toBeNull();
  });

  it('drops pending photos, searches and scans when the session resets', () => {
    const camera = fileInput();
    const library = fileInput();
    vi.spyOn(camera, 'click').mockImplementation(() => undefined);
    capture.attachInputs({ camera, library });
    capture.requestCamera('food_photo', 'Lunch at work');
    selectFile(camera, new File(['x'], 'meal.jpg', { type: 'image/jpeg' }));
    capture.openSearch('pasta');
    capture.requestBarcode();
    capture.requestLabelScan('4006381333931');

    TestBed.inject(SessionScope).reset();

    expect(capture.pending()).toBeNull();
    expect(capture.searchRequest()).toBeNull();
    expect(capture.scanRequest()).toBeNull();
    const file = new File(['y'], 'next.jpg', { type: 'image/jpeg' });
    selectFile(camera, file);
    expect(capture.pending()).toEqual({ file, mode: 'food_photo', source: 'camera' });
  });
});
