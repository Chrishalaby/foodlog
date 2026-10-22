import { Component, computed, input } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { TARGET_KEYS, TARGET_META, type TargetKey, type TargetValues } from '@food/shared';
import { Icon } from '../../../shared/ui/icon';
import { formatNumber } from '../../../shared/utils/format';
import { DecimalField } from '../controls/decimal-field';
import { FieldError } from '../controls/field-error';
import type { ProfileFormModel } from '../profile-model';
import { SettingsSection } from './settings-section';

export const TARGET_KIND_LABELS = { goal: 'Goal', min: 'Minimum', max: 'Limit' } as const;

interface TargetRow {
  key: TargetKey;
  label: string;
  unit: string;
  kind: string;
  autoText: string;
  placeholder: string;
  overridden: boolean;
}

@Component({
  selector: 'app-targets-section',
  imports: [SettingsSection, FormField, DecimalField, FieldError, Icon],
  template: `
    @let f = form();
    <app-settings-section
      sectionId="settings-targets"
      heading="Daily targets"
      icon="flame"
      tone="calories"
      description="Calculated from your profile. Type a value to override it; tap Auto to go back."
    >
      @if (warnings().length > 0) {
        <ul class="mb-3 flex flex-col gap-2" aria-label="Target warnings">
          @for (warning of warnings(); track warning) {
            <li
              class="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5 text-sm leading-snug text-warn"
            >
              <app-icon class="mt-px" name="alert" [size]="16" />
              <span>{{ warning }}</span>
            </li>
          }
        </ul>
      }
      <ul class="-my-1 divide-y divide-line/60">
        @for (row of rows(); track row.key) {
          <li class="py-3">
            <div class="flex items-center gap-2">
              <div class="min-w-0 flex-1">
                <label class="block text-sm font-semibold text-fg" [for]="'target-' + row.key">
                  {{ row.label }}
                </label>
                <p
                  class="mt-0.5 text-xs text-muted tabular-nums"
                  [id]="'target-' + row.key + '-hint'"
                >
                  <span class="font-medium">{{ row.kind }}</span>
                  · auto {{ row.autoText }} {{ row.unit }}
                  @if (row.overridden) {
                    <span class="font-medium text-accent"> · custom</span>
                  }
                </p>
              </div>
              <app-decimal-field
                class="w-[7.5rem] shrink-0"
                [inputId]="'target-' + row.key"
                [describedBy]="'target-' + row.key + '-hint target-' + row.key + '-error'"
                [unit]="row.unit"
                [decimals]="0"
                [placeholder]="row.placeholder"
                [formField]="f.overrides[row.key]"
              />
              <button
                type="button"
                class="btn btn-ghost min-w-11 shrink-0 px-2 text-sm text-accent"
                [class.invisible]="!row.overridden"
                [attr.aria-label]="'Use the automatic ' + row.label.toLowerCase()"
                (click)="useAuto(row.key)"
              >
                Auto
              </button>
            </div>
            <app-field-error
              [errorId]="'target-' + row.key + '-error'"
              [field]="f.overrides[row.key]"
            />
          </li>
        }
      </ul>
    </app-settings-section>
  `,
})
export class TargetsSection {
  readonly form = input.required<FieldTree<ProfileFormModel>>();
  readonly autoValues = input.required<TargetValues>();
  readonly warnings = input<readonly string[]>([]);

  protected readonly rows = computed<TargetRow[]>(() => {
    const auto = this.autoValues();
    const overrides = this.form().overrides().value();
    return TARGET_KEYS.map((key) => ({
      key,
      label: TARGET_META[key].label,
      unit: TARGET_META[key].unit,
      kind: TARGET_KIND_LABELS[TARGET_META[key].kind],
      autoText: formatNumber(auto[key]),
      placeholder: String(Math.round(auto[key])),
      overridden: overrides[key] !== null,
    }));
  });

  protected useAuto(key: TargetKey): void {
    const field = this.form().overrides[key];
    field().value.set(null);
    field().focusBoundControl();
  }
}
