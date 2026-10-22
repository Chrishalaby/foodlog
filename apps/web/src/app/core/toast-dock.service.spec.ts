import { TestBed } from '@angular/core/testing';
import { TOAST_CLEARANCE_ATTRIBUTE, ToastDock } from './toast-dock.service';

function placed(top: number, height = 60, attribute = true): HTMLElement {
  const element = document.createElement('div');
  if (attribute) {
    element.setAttribute(TOAST_CLEARANCE_ATTRIBUTE, '');
  }
  element.getBoundingClientRect = () =>
    ({ top, height, width: height > 0 ? 300 : 0, bottom: top + height }) as DOMRect;
  document.body.appendChild(element);
  return element;
}

describe('ToastDock', () => {
  let dock: ToastDock;
  const added: HTMLElement[] = [];

  beforeEach(() => {
    dock = TestBed.inject(ToastDock);
  });

  afterEach(() => {
    added.splice(0).forEach((element) => element.remove());
  });

  function add(top: number, height?: number, attribute?: boolean): HTMLElement {
    const element = placed(top, height, attribute);
    added.push(element);
    return element;
  }

  it('keeps toasts clear of the highest bar at the bottom of the screen', () => {
    add(window.innerHeight - 90);
    add(window.innerHeight - 150);
    dock.measure();
    expect(dock.clearance()).toBe(150);
  });

  it('ignores hidden and off-screen bars', () => {
    add(window.innerHeight - 200, 0);
    add(window.innerHeight + 10);
    dock.measure();
    expect(dock.clearance()).toBe(0);
  });

  it('ignores elements that are not marked as bottom bars', () => {
    const host = document.createElement('app-sticky-actions');
    const tray = placed(window.innerHeight - 120, 120, false);
    host.appendChild(tray);
    document.body.appendChild(host);
    added.push(host);
    dock.measure();
    expect(dock.clearance()).toBe(0);
  });

  it('drops the clearance once the bars are gone', () => {
    const bar = add(window.innerHeight - 90);
    dock.measure();
    expect(dock.clearance()).toBe(90);
    bar.remove();
    dock.measure();
    expect(dock.clearance()).toBe(0);
  });

  it('measures again when the window resizes', () => {
    add(window.innerHeight - 80);
    window.dispatchEvent(new Event('resize'));
    expect(dock.clearance()).toBe(80);
  });
});
