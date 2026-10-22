import { Component, input } from '@angular/core';
import { Icon } from '../../shared/ui/icon';
import type { TableCell, TableRow } from './compare-ranking';

export interface TableColumn {
  readonly id: string;
  readonly name: string;
  readonly best: boolean;
}

@Component({
  selector: 'app-compare-table',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <section class="card overflow-hidden" aria-labelledby="compare-table-title">
      <h2 id="compare-table-title" class="section-title px-4 pt-4 pb-2">Side by side</h2>
      <div class="overflow-x-auto overscroll-x-contain">
        <table class="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr>
              <th scope="col" class="py-2 pr-1 pl-4 text-left">
                <span class="sr-only">Nutrient</span>
              </th>
              @for (column of columns(); track column.id) {
                <th
                  scope="col"
                  class="px-1 py-2 text-right align-bottom text-xs leading-4 font-semibold text-fg last:pr-3"
                >
                  <span class="ml-auto flex max-w-[5.5rem] flex-col items-end gap-0.5">
                    @if (column.best) {
                      <app-icon class="text-brand" name="sparkles" [size]="14" />
                      <span class="sr-only">Best fit:</span>
                    }
                    <span class="line-clamp-2 break-words" [class.text-brand]="column.best">{{
                      column.name
                    }}</span>
                  </span>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.key) {
              <tr class="border-t border-line/60">
                <th
                  scope="row"
                  class="py-2 pr-1 pl-4 text-left font-medium whitespace-nowrap text-muted"
                >
                  {{ row.label }}
                  @if (row.unit === 'mg') {
                    <span class="text-[11px] font-normal">mg</span>
                  }
                </th>
                @for (cell of row.cells; track cell.id) {
                  <td class="px-1 py-1.5 text-right last:pr-3">
                    <span
                      class="inline-block rounded-lg px-1.5 py-0.5 font-semibold whitespace-nowrap"
                      [class]="cellTone(cell)"
                    >
                      {{ cell.text }}
                      @if (cell.best) {
                        <span class="sr-only">(best)</span>
                      }
                      @if (cell.over) {
                        <span class="sr-only">(over your limit)</span>
                      }
                    </span>
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-1 pb-3 text-xs text-muted">
        <span class="inline-flex items-center gap-1.5">
          <span class="size-2 rounded-full bg-brand" aria-hidden="true"></span>
          Best for what's left today
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="size-2 rounded-full bg-danger" aria-hidden="true"></span>
          Over your budget
        </span>
        <span>Grams unless noted</span>
      </p>
    </section>
  `,
})
export class CompareTable {
  readonly columns = input.required<readonly TableColumn[]>();
  readonly rows = input.required<readonly TableRow[]>();

  protected cellTone(cell: TableCell): string {
    if (cell.over) {
      return cell.best ? 'bg-danger/10 text-danger' : 'text-danger';
    }
    return cell.best ? 'bg-brand/12 text-brand' : 'text-fg';
  }
}
