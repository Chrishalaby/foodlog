import { TestBed } from '@angular/core/testing';
import { ToastService } from '../../core/toast.service';
import { COPY_FAILED_MESSAGE, ShareLink, canShare, whatsappUrl } from './share-link';
import { buttonByText } from './testing/admin-fixtures';

const URL = 'https://food.example.com/invite/abc';

describe('ShareLink', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  async function render() {
    const fixture = TestBed.createComponent(ShareLink);
    fixture.componentRef.setInput('url', URL);
    fixture.componentRef.setInput('title', 'FoodLog invite');
    fixture.componentRef.setInput('text', 'Hi Nour! Here is your invite:');
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('uses the native share sheet when the device has one', async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    const { fixture, el } = await render();
    buttonByText(el, 'Share…').click();
    await fixture.whenStable();
    expect(share).toHaveBeenCalledWith({
      title: 'FoodLog invite',
      text: 'Hi Nour! Here is your invite:',
      url: URL,
    });
  });

  it('stays quiet when sharing is cancelled', async () => {
    const share = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError');
    });
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    const { fixture, el } = await render();
    buttonByText(el, 'Share…').click();
    await fixture.whenStable();
    expect(TestBed.inject(ToastService).toasts()).toEqual([]);
  });

  it('falls back to a WhatsApp link without the Web Share API', async () => {
    const { el } = await render();
    const link = Array.from(el.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('WhatsApp'),
    );
    expect(link?.getAttribute('href')).toBe(
      `https://wa.me/?text=${encodeURIComponent(`Hi Nour! Here is your invite:\n${URL}`)}`,
    );
    expect(link?.getAttribute('rel')).toContain('noopener');
  });

  it('copies the link and confirms it', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { fixture, el } = await render();
    buttonByText(el, 'Copy link').click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(el.textContent).toContain('Copied');
  });

  it('explains when copying is impossible', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied');
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { fixture, el } = await render();
    buttonByText(el, 'Copy link').click();
    await fixture.whenStable();
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((t) => t.message),
    ).toContain(COPY_FAILED_MESSAGE);
  });
});

describe('share helpers', () => {
  it('respects canShare and builds WhatsApp links', () => {
    const content = { title: 't', text: 'hello', url: URL };
    expect(canShare(undefined, content)).toBe(false);
    expect(canShare({ share: vi.fn() } as unknown as Navigator, content)).toBe(true);
    expect(
      canShare({ share: vi.fn(), canShare: () => false } as unknown as Navigator, content),
    ).toBe(false);
    expect(whatsappUrl(content)).toBe(`https://wa.me/?text=hello%0A${encodeURIComponent(URL)}`);
  });
});
