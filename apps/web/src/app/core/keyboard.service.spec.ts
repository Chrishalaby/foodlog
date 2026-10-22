import { TestBed } from '@angular/core/testing';
import { KeyboardService, isTextEntry, keyboardShrinkThreshold } from './keyboard.service';

interface FakeViewport extends EventTarget {
  height: number;
  width: number;
  scale: number;
}

describe('KeyboardService', () => {
  const originals = {
    innerHeight: Object.getOwnPropertyDescriptor(window, 'innerHeight'),
    innerWidth: Object.getOwnPropertyDescriptor(window, 'innerWidth'),
    visualViewport: Object.getOwnPropertyDescriptor(window, 'visualViewport'),
  };
  let viewport: FakeViewport | null;
  let field: HTMLInputElement;

  function setWindow(width: number, height: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }

  function useViewport(height: number, scale = 1): FakeViewport {
    const fake = Object.assign(new EventTarget(), { height, width: 390, scale });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
    viewport = fake;
    return fake;
  }

  function resize(height: number, width = window.innerWidth): void {
    setWindow(width, height);
    if (viewport) {
      viewport.height = height;
      viewport.dispatchEvent(new Event('resize'));
    }
    window.dispatchEvent(new Event('resize'));
  }

  function focus(target: HTMLElement, from: HTMLElement | null = null): void {
    from?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: target }));
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: from }));
  }

  function blur(target: HTMLElement, to: HTMLElement | null = null): void {
    target.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }));
  }

  beforeEach(() => {
    viewport = null;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    setWindow(390, 800);
    field = document.createElement('input');
    field.type = 'text';
    document.body.append(field);
  });

  afterEach(() => {
    field.remove();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) {
        Object.defineProperty(window, key, descriptor);
      } else {
        Reflect.deleteProperty(window, key);
      }
    }
  });

  it('reports the keyboard while a text field is focused and the viewport shrinks', () => {
    const keyboard = TestBed.inject(KeyboardService);
    focus(field);
    expect(keyboard.open()).toBe(false);
    resize(460);
    expect(keyboard.open()).toBe(true);
    resize(800);
    expect(keyboard.open()).toBe(false);
  });

  it('closes as soon as focus leaves the text fields', () => {
    const keyboard = TestBed.inject(KeyboardService);
    const button = document.createElement('button');
    document.body.append(button);
    focus(field);
    resize(460);
    expect(keyboard.open()).toBe(true);
    blur(field, button);
    expect(keyboard.open()).toBe(false);
    button.remove();
  });

  it('stays open while focus moves between text fields', () => {
    const keyboard = TestBed.inject(KeyboardService);
    const other = document.createElement('textarea');
    document.body.append(other);
    focus(field);
    resize(460);
    focus(other, field);
    expect(keyboard.open()).toBe(true);
    other.remove();
  });

  it('ignores a desktop window made shorter without a focused text field', () => {
    const keyboard = TestBed.inject(KeyboardService);
    resize(420);
    expect(keyboard.open()).toBe(false);
    focus(field);
    expect(keyboard.open()).toBe(false);
  });

  it('ignores small changes such as the browser toolbar hiding', () => {
    const keyboard = TestBed.inject(KeyboardService);
    focus(field);
    resize(744);
    expect(keyboard.open()).toBe(false);
  });

  it('measures the visual viewport and does not mistake pinch zoom for a keyboard', () => {
    const fake = useViewport(800);
    const keyboard = TestBed.inject(KeyboardService);
    focus(field);
    fake.scale = 2;
    fake.height = 400;
    fake.dispatchEvent(new Event('resize'));
    expect(keyboard.open()).toBe(false);
    fake.scale = 1;
    fake.height = 480;
    fake.dispatchEvent(new Event('resize'));
    expect(keyboard.open()).toBe(true);
  });

  it('opens on iOS where only the visual viewport shrinks', () => {
    const fake = useViewport(800);
    const keyboard = TestBed.inject(KeyboardService);
    focus(field);
    fake.height = 500;
    fake.dispatchEvent(new Event('resize'));
    expect(window.innerHeight).toBe(800);
    expect(keyboard.open()).toBe(true);
  });

  it('starts over after a rotation', () => {
    const keyboard = TestBed.inject(KeyboardService);
    focus(field);
    resize(360, 800);
    expect(keyboard.open()).toBe(false);
    resize(200, 800);
    expect(keyboard.open()).toBe(true);
  });

  it('treats only editable text controls as keyboard targets', () => {
    const make = (type: string): HTMLInputElement => {
      const input = document.createElement('input');
      input.type = type;
      return input;
    };
    expect(isTextEntry(make('text'))).toBe(true);
    expect(isTextEntry(make('search'))).toBe(true);
    expect(isTextEntry(make('email'))).toBe(true);
    expect(isTextEntry(make('number'))).toBe(true);
    expect(isTextEntry(make('checkbox'))).toBe(false);
    expect(isTextEntry(make('file'))).toBe(false);
    expect(isTextEntry(make('date'))).toBe(false);
    const readonly = make('text');
    readonly.readOnly = true;
    expect(isTextEntry(readonly)).toBe(false);
    expect(isTextEntry(document.createElement('textarea'))).toBe(true);
    expect(isTextEntry(document.createElement('button'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });

  it('needs a bigger shrink on tall screens than on short ones', () => {
    expect(keyboardShrinkThreshold(800)).toBe(150);
    expect(keyboardShrinkThreshold(360)).toBe(90);
  });
});
