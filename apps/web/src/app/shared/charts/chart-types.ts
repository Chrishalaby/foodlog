import type {
  BarSeriesOption,
  GaugeSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
} from 'echarts/charts';
import type {
  DatasetComponentOption,
  GridComponentOption,
  LegendComponentOption,
  MarkAreaComponentOption,
  MarkLineComponentOption,
  TooltipComponentOption,
} from 'echarts/components';
import type { ComposeOption } from 'echarts/core';

export type ChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | GaugeSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | DatasetComponentOption
  | MarkLineComponentOption
  | MarkAreaComponentOption
>;

export type { BarSeriesOption, GaugeSeriesOption, LineSeriesOption, PieSeriesOption };
