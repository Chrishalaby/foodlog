import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormField, form, max, min } from '@angular/forms/signals';
import { ChoiceField, type ChoiceOption } from './choice-field';
import { DecimalField, formatOptionalNumber, parseOptionalNumber } from './decimal-field';
import { SERVER_DEFAULT_ID, modelChoices } from './model-picker';
import { StepperField, clampStep } from './stepper-field';

interface Model {
  weight: number | null;
  days: number;
  size: 'small' | 'large';
}

@Component({
  imports: [FormField, DecimalField, StepperField, ChoiceField],
  template: `
    <app-decimal-field inputId="weight" unit="kg" [formField]="f.weight" />
    <app-stepper-field labelledBy="days" [formField]="f.days" />
    <app-choice-field ariaLabel="Size" [options]="sizes" [formField]="f.size" />
  `,
})
class Host {
  readonly model = signal<Model>({ weight: 72.5, days: 6, size: 'small' });
  readonly f = form(this.model, (path) => {
    min(path.days, 0);
    max(path.days, 7);
  });
  readonly sizes: ChoiceOption<'small' | 'large'>[] = [
    { value: 'small', label: 'Small' },
    { value: 'large', label: 'Large' },
  ];
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('settings form controls', () => {
  it('parses optional decimals with commas and empty values', () => {
    expect(parseOptionalNumber('', 1)).toEqual({ value: null });
    expect(parseOptionalNumber('72,46', 1)).toEqual({ value: 72.5 });
    expect(parseOptionalNumber('abc', 1).error).toBeDefined();
    expect(formatOptionalNumber(null)).toBe('');
    expect(formatOptionalNumber(80)).toBe('80');
    expect(clampStep(9, 0, 7)).toBe(7);
    expect(clampStep(-1, 0, 7)).toBe(0);
  });

  it('binds the custom controls to a signal form', async () => {
    const fixture = TestBed.createComponent(Host);
    const host = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const weight = el.querySelector<HTMLInputElement>('#weight')!;
    expect(weight.value).toBe('72.5');
    typeInto(weight, '81,3');
    await fixture.whenStable();
    expect(host.model().weight).toBe(81.3);
    typeInto(weight, '');
    await fixture.whenStable();
    expect(host.model().weight).toBeNull();
    typeInto(weight, 'abc');
    weight.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(host.f.weight().invalid()).toBe(true);
    expect(weight.getAttribute('aria-invalid')).toBe('true');

    const spin = el.querySelector<HTMLElement>('[role="spinbutton"]')!;
    expect(spin.getAttribute('aria-valuemax')).toBe('7');
    spin.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    spin.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    await fixture.whenStable();
    expect(host.model().days).toBe(7);
    spin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    await fixture.whenStable();
    expect(host.model().days).toBe(0);

    const radios = el.querySelectorAll<HTMLInputElement>('app-choice-field input[type="radio"]');
    expect(radios[0].checked).toBe(true);
    radios[1].click();
    await fixture.whenStable();
    expect(host.model().size).toBe('large');
  });

  it('builds model choices with the server default first', () => {
    const choices = modelChoices(
      [
        {
          id: 'gpt-5.6-sol',
          label: 'GPT-5.6 Sol',
          description: 'Default.',
          estCostPerRequestUsd: 0.0412,
          recommended: true,
        },
      ],
      'gpt-5.6-sol',
      'legacy-model',
    );
    expect(choices.map((choice) => choice.id)).toEqual([
      SERVER_DEFAULT_ID,
      'gpt-5.6-sol',
      'legacy-model',
    ]);
    expect(choices[0].description).toContain('GPT-5.6 Sol');
    expect(choices[1].cost).toBe('$0.041');
    expect(choices[2].cost).toBeNull();
  });
});
