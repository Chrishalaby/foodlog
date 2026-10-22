import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WeightField } from './weight-field';

@Component({
  imports: [WeightField],
  template: `
    <app-weight-field inputId="weight-field-test" [(text)]="text" [fallback]="82.4" />
    <button type="button" id="elsewhere">Elsewhere</button>
  `,
})
class Host {
  readonly text = signal('82.4');
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('WeightField', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#weight-field-test')!;
    return { fixture, host: fixture.componentInstance, el, input };
  }

  it('selects the whole prefilled weight after a tap places the caret, so typing replaces it', async () => {
    const { fixture, host, input } = await render();
    expect(input.value).toBe('82.4');

    input.focus();
    input.setSelectionRange(2, 2);
    await nextTask();

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(4);

    input.value = '81.9';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(host.text()).toBe('81.9');
  });

  it('leaves the caret alone when the field loses focus before the selection runs', async () => {
    const { el, input } = await render();

    input.focus();
    input.setSelectionRange(2, 2);
    el.querySelector<HTMLButtonElement>('#elsewhere')!.focus();
    await nextTask();

    expect(document.activeElement).not.toBe(input);
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);
  });

  it('keeps a caret the user places inside an already focused field', async () => {
    const { input } = await render();

    input.focus();
    await nextTask();
    input.setSelectionRange(3, 3);
    await nextTask();

    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);
  });
});
