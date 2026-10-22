import { Component, computed, input } from '@angular/core';

interface IconDef {
  paths: readonly string[];
  filled?: boolean;
}

const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const STAR =
  'M12 2.8l2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.14l-5.62 2.96 1.07-6.27L2.9 9.4l6.3-.9z';

export const ICONS = {
  book: {
    paths: [
      'M2.5 5A1.5 1.5 0 0 1 4 3.5h5A3 3 0 0 1 12 6.5V20a2.5 2.5 0 0 0-2.5-2.5H4A1.5 1.5 0 0 1 2.5 16z',
      'M21.5 5A1.5 1.5 0 0 0 20 3.5h-5a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H20a1.5 1.5 0 0 0 1.5-1.5z',
    ],
  },
  camera: {
    paths: [
      'M14.5 4h-5L7.5 6.5H4.5A2.5 2.5 0 0 0 2 9v9a2.5 2.5 0 0 0 2.5 2.5h15A2.5 2.5 0 0 0 22 18V9a2.5 2.5 0 0 0-2.5-2.5h-3z',
      circle(12, 13, 3.5),
    ],
  },
  image: {
    paths: [
      'M5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3z',
      circle(9, 9, 2),
      'm21 15-3.3-3.3a2 2 0 0 0-2.8 0L6 21',
    ],
  },
  label: {
    paths: [
      'M3 7.5V5.5A2.5 2.5 0 0 1 5.5 3h2',
      'M16.5 3h2A2.5 2.5 0 0 1 21 5.5v2',
      'M21 16.5v2a2.5 2.5 0 0 1-2.5 2.5h-2',
      'M7.5 21h-2A2.5 2.5 0 0 1 3 18.5v-2',
      'M7.5 8.5h9',
      'M7.5 12h9',
      'M7.5 15.5h5',
    ],
  },
  text: { paths: ['M4 6h16', 'M4 12h16', 'M4 18h10'] },
  mic: {
    paths: [
      'M12 2.5a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0v-6a3 3 0 0 0-3-3z',
      'M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1',
      'M12 18v3.5',
    ],
  },
  stop: {
    paths: [
      'M8 5.5h8A2.5 2.5 0 0 1 18.5 8v8a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 16V8A2.5 2.5 0 0 1 8 5.5z',
    ],
    filled: true,
  },
  star: { paths: [STAR] },
  'star-filled': { paths: [STAR], filled: true },
  history: {
    paths: ['M3 12a9 9 0 1 0 2.64-6.36L3 8.25', 'M3 3.5v4.75h4.75', 'M12 7.5V12l3 2'],
  },
  chart: { paths: ['M4 20h16', 'M7 16v-4', 'M12 16V6', 'M17 16V9'] },
  settings: {
    paths: ['M14 17H4', 'M20 7H10', circle(17, 17, 3), circle(7, 7, 3)],
  },
  home: {
    paths: [
      'M3 10.5 12 3l9 7.5',
      'M5 9v10.5A1.5 1.5 0 0 0 6.5 21H10v-6h4v6h3.5a1.5 1.5 0 0 0 1.5-1.5V9',
    ],
  },
  plus: { paths: ['M12 5v14', 'M5 12h14'] },
  minus: { paths: ['M5 12h14'] },
  droplet: {
    paths: ['M12 2.7c-2.6 3.6-6.5 7.4-6.5 11.6a6.5 6.5 0 0 0 13 0c0-4.2-3.9-8-6.5-11.6z'],
  },
  trash: {
    paths: [
      'M3.5 6h17',
      'M8.5 6V4.5A1.5 1.5 0 0 1 10 3h4a1.5 1.5 0 0 1 1.5 1.5V6',
      'M18.5 6l-.8 13.1a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5.5 6',
      'M10 11v5.5',
      'M14 11v5.5',
    ],
  },
  edit: { paths: ['M13 20h8', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'] },
  copy: {
    paths: [
      'M10.5 9h9A1.5 1.5 0 0 1 21 10.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 9 19.5v-9A1.5 1.5 0 0 1 10.5 9z',
      'M15 5.5v-1A1.5 1.5 0 0 0 13.5 3h-9A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15h1',
    ],
  },
  'chevron-left': { paths: ['m15 18-6-6 6-6'] },
  'chevron-right': { paths: ['m9 18 6-6-6-6'] },
  'chevron-down': { paths: ['m6 9 6 6 6-6'] },
  'chevron-up': { paths: ['m18 15-6-6-6 6'] },
  close: { paths: ['M18 6 6 18', 'M6 6l12 12'] },
  check: { paths: ['M20 6 9 17l-5-5'] },
  alert: {
    paths: [
      'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
      'M12 9v4',
      'M12 17h.01',
    ],
  },
  info: { paths: [circle(12, 12, 9.5), 'M12 16v-4.5', 'M12 8h.01'] },
  flame: {
    paths: [
      'M12 21.5c-3.9 0-7-2.9-7-6.8 0-2.6 1.4-4.6 2.9-6.1.3 1.6 1.2 2.8 2.4 3.3C10.1 8.3 11.5 5 14.8 2.5c-.2 2.7.8 4.6 2.2 6.3 1.2 1.5 2 3.3 2 5.4 0 4-3.1 7.3-7 7.3z',
      'M12 21.5c-1.7 0-3-1.3-3-3 0-1.5 1-2.6 2.1-3.6.2 1 .8 1.6 1.5 1.8.1-1.3.6-2.4 1.6-3.3.9 1.1 1.8 2.5 1.8 4.4 0 2.1-1.9 3.7-4 3.7z',
    ],
  },
  dumbbell: {
    paths: ['M6.5 7v10', 'M17.5 7v10', 'M3.5 9.5v5', 'M20.5 9.5v5', 'M6.5 12h11'],
  },
  download: { paths: ['M12 3.5v11.5', 'm7 10.5 5 5 5-5', 'M4.5 20.5h15'] },
  logout: {
    paths: [
      'M9.5 21h-4A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3h4',
      'm16 16.5 4.5-4.5L16 7.5',
      'M20.5 12H9',
    ],
  },
  sparkles: {
    paths: [
      'M11 3.5l1.8 4.9 4.9 1.8-4.9 1.8L11 16.9l-1.8-4.9-4.9-1.8 4.9-1.8z',
      'M19 3v4',
      'M17 5h4',
      'M18 16.5v4',
      'M16 18.5h4',
    ],
  },
  refresh: {
    paths: [
      'M20.5 12A8.5 8.5 0 0 1 6 18l-2.5-2.5',
      'M3.5 20.5v-5h5',
      'M3.5 12A8.5 8.5 0 0 1 18 6l2.5 2.5',
      'M20.5 3.5v5h-5',
    ],
  },
  search: { paths: [circle(11, 11, 7), 'm20.5 20.5-4.5-4.5'] },
  clock: { paths: [circle(12, 12, 9.5), 'M12 7v5l3.5 2'] },
  scale: {
    paths: [
      'M6.3 9h11.4a1 1 0 0 1 1 .8l2.2 10a1 1 0 0 1-1 1.2H4.1a1 1 0 0 1-1-1.2l2.2-10a1 1 0 0 1 1-.8z',
      circle(12, 5.5, 2.5),
    ],
  },
  more: { paths: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'] },
  'more-horizontal': { paths: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'] },
  utensils: {
    paths: [
      'M7 2.5v19',
      'M4 2.5v6a3 3 0 0 0 6 0v-6',
      'M17.5 21.5v-19c-2.5 1-4 3.8-4 7.5 0 2.2 1 3.5 4 3.5',
    ],
  },
  'wifi-off': {
    paths: [
      'M2.5 2.5l19 19',
      'M8.5 16.4a5 5 0 0 1 7 0',
      'M5 12.9a10 10 0 0 1 5.2-2.7',
      'M16.7 10.7a10 10 0 0 1 2.3 2.2',
      'M2 8.8a15 15 0 0 1 4.2-2.6',
      'M10.7 5a15 15 0 0 1 11.3 3.8',
      'M12 20h.01',
    ],
  },
  sun: {
    paths: [
      circle(12, 12, 4),
      'M12 2v2',
      'M12 20v2',
      'm4.9 4.9 1.4 1.4',
      'm17.7 17.7 1.4 1.4',
      'M2 12h2',
      'M20 12h2',
      'm6.3 17.7-1.4 1.4',
      'm19.1 4.9-1.4 1.4',
    ],
  },
  moon: { paths: ['M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6z'] },
  eye: {
    paths: ['M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z', circle(12, 12, 3)],
  },
  'eye-off': {
    paths: [
      'M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.2 3.2',
      'M6.6 6.6A17 17 0 0 0 2.5 12s3.5 7 9.5 7a9.6 9.6 0 0 0 5.4-1.6',
      'M9.9 9.9a3 3 0 0 0 4.2 4.2',
      'M2.5 2.5l19 19',
    ],
  },
  lock: {
    paths: [
      'M6.5 11h11a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V13a2 2 0 0 1 2-2z',
      'M8 11V7.5a4 4 0 0 1 8 0V11',
    ],
  },
  mail: {
    paths: [
      'M4.5 5h15A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5z',
      'm22 7.5-10 6-10-6',
    ],
  },
  key: {
    paths: [circle(7.5, 15.5, 4.5), 'm10.7 12.3 9.8-9.8', 'm15.5 7.5 3 3', 'm18 5 2 2'],
  },
  barcode: {
    paths: [
      'M3 7.5V5.5A2.5 2.5 0 0 1 5.5 3h2',
      'M16.5 3h2A2.5 2.5 0 0 1 21 5.5v2',
      'M21 16.5v2a2.5 2.5 0 0 1-2.5 2.5h-2',
      'M7.5 21h-2A2.5 2.5 0 0 1 3 18.5v-2',
      'M7 7.5v9',
      'M10 7.5v9',
      'M12.5 7.5v9',
      'M14.5 7.5v9',
      'M17 7.5v9',
    ],
  },
  flashlight: {
    paths: [
      'M7 2.5h10v3.5l-2.5 4v10.5a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V10L7 6z',
      'M7 6h10',
      'M12 13.5v2',
    ],
  },
  keyboard: {
    paths: [
      'M4.5 5.5h15A2.5 2.5 0 0 1 22 8v8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16V8a2.5 2.5 0 0 1 2.5-2.5z',
      'M6 9.5h.01',
      'M10 9.5h.01',
      'M14 9.5h.01',
      'M18 9.5h.01',
      'M6 12.5h.01',
      'M18 12.5h.01',
      'M8 15.5h8',
    ],
  },
  users: {
    paths: [
      circle(9, 8, 3.5),
      'M2.5 20.5v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1',
      'M16 4.6a3.5 3.5 0 0 1 0 6.8',
      'M18.5 14.6a5 5 0 0 1 3 4.4v1.5',
    ],
  },
  'user-plus': {
    paths: [
      circle(9, 8, 3.5),
      'M2.5 20.5v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1',
      'M19 8v6',
      'M16 11h6',
    ],
  },
  'user-check': {
    paths: [circle(9, 8, 3.5), 'M2.5 20.5v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1', 'm16 11 2 2 4-4'],
  },
  shield: {
    paths: [
      'M12 21.5s7.5-3.2 7.5-9.5V5.2L12 2.5 4.5 5.2V12c0 6.3 7.5 9.5 7.5 9.5z',
      'm9 12 2 2 4-4',
    ],
  },
  send: { paths: ['M12 19.5V5', 'm5.5 11.5 6.5-6.5 6.5 6.5'] },
  share: {
    paths: [
      'M12 3v12',
      'm7.5 7.5 4.5-4.5 4.5 4.5',
      'M5 12.5v6A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-6',
    ],
  },
  link: {
    paths: [
      'M10 13.5a4.5 4.5 0 0 0 6.4.3l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2',
      'M14 10.5a4.5 4.5 0 0 0-6.4-.3l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2',
    ],
  },
  phone: {
    paths: [
      'M8 2.5h8A2 2 0 0 1 18 4.5v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z',
      'M11 18.5h2',
    ],
  },
  tablet: {
    paths: [
      'M6 2.5h12A2 2 0 0 1 20 4.5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z',
      'M11 18.5h2',
    ],
  },
  laptop: { paths: ['M5 5.5h14a1 1 0 0 1 1 1V16H4V6.5a1 1 0 0 1 1-1z', 'M2 19.5h20'] },
  globe: {
    paths: [
      circle(12, 12, 9.5),
      'M2.5 12h19',
      'M12 2.5c2.5 2.6 3.8 5.8 3.8 9.5s-1.3 6.9-3.8 9.5c-2.5-2.6-3.8-5.8-3.8-9.5S9.5 5.1 12 2.5z',
    ],
  },
  ban: { paths: [circle(12, 12, 9.5), 'm5.3 5.3 13.4 13.4'] },
  wallet: {
    paths: [
      'M4.5 5.5h13a2 2 0 0 1 2 2v1',
      'M3 7.5v10A2.5 2.5 0 0 0 5.5 20h14a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 19.5 9H5a2 2 0 0 1-2-2 2 2 0 0 1 2-2',
      'M16.5 14.5h.01',
    ],
  },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'app-icon',
  host: {
    class: 'inline-flex shrink-0 items-center justify-center',
    'aria-hidden': 'true',
  },
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.fill]="filled() ? 'currentColor' : 'none'"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth()"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
    >
      @for (d of paths(); track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly strokeWidth = input(2);

  protected readonly def = computed<IconDef>(() => ICONS[this.name()]);
  protected readonly paths = computed(() => this.def().paths);
  protected readonly filled = computed(() => this.def().filled === true);
}
