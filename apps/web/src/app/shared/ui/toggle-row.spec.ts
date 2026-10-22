import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ToggleRow } from './toggle-row';

@Component({
  imports: [ToggleRow],
  template: `
    <app-toggle-row
      title="Save as favorite"
      detail="Log it again with one tap"
      [disabled]="disabled()"
      [(checked)]="checked"
    />
  `,
})
class Host {
  readonly checked = signal(false);
  readonly disabled = signal(false);
}

describe('ToggleRow', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const toggle = el.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    const track = (): HTMLElement => toggle.querySelector<HTMLElement>('span.rounded-full')!;
    return { fixture, host: fixture.componentInstance, toggle, track };
  }

  it('draws the off track with the field boundary colour so it stays visible', async () => {
    const { toggle, track } = await render();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(track().classList.contains('bg-field-line')).toBe(true);
    expect(track().classList.contains('bg-line')).toBe(false);
    expect(track().classList.contains('bg-brand')).toBe(false);
  });

  it('switches on and off with a tap', async () => {
    const { fixture, host, toggle, track } = await render();

    toggle.click();
    await fixture.whenStable();
    expect(host.checked()).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(track().classList.contains('bg-brand')).toBe(true);
    expect(track().classList.contains('bg-field-line')).toBe(false);

    toggle.click();
    await fixture.whenStable();
    expect(host.checked()).toBe(false);
  });

  it('names the switch after its title and detail', async () => {
    const { toggle } = await render();
    expect(toggle.textContent).toContain('Save as favorite');
    expect(toggle.textContent).toContain('Log it again with one tap');
  });

  it('ignores taps while disabled', async () => {
    const { fixture, host, toggle } = await render();
    host.disabled.set(true);
    await fixture.whenStable();
    expect(toggle.disabled).toBe(true);
  });
});
