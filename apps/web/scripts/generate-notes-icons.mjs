import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const iconsDir = join(import.meta.dirname, '..', 'public', 'icons', 'notes');

const ICON_SIZES = [192, 512];
const MASKABLE_SIZES = [192, 512];
const TILE_LIGHT = '#ffd15c';
const TILE_DARK = '#f08c00';
const PAPER = '#ffffff';
const FOLD = '#ffe2a0';
const INK = '#c56a00';

const GLYPH = [
  `<path d="M172 112H340a36 36 0 0 1 36 36V306L290 400H172a36 36 0 0 1-36-36V148a36 36 0 0 1 36-36Z" fill="${PAPER}"/>`,
  `<path d="M290 400V342a36 36 0 0 1 36-36H376Z" fill="${FOLD}"/>`,
  `<path d="M188 188H324M188 244H324M188 300H256" fill="none" stroke="${INK}" stroke-width="24" stroke-linecap="round"/>`,
].join('');

function iconSvg({ shape, glyphScale }) {
  const background =
    shape === 'rounded'
      ? '<rect width="512" height="512" rx="116" fill="url(#bg)"/>'
      : '<rect width="512" height="512" fill="url(#bg)"/>';
  const offset = 256 * (1 - glyphScale);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${TILE_LIGHT}"/>`,
    `<stop offset="1" stop-color="${TILE_DARK}"/>`,
    '</linearGradient>',
    '</defs>',
    background,
    `<g transform="translate(${offset} ${offset}) scale(${glyphScale})">`,
    GLYPH,
    '</g>',
    '</svg>',
  ].join('');
}

async function renderPng(svg, size, file) {
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(iconsDir, file));
}

async function main() {
  await mkdir(iconsDir, { recursive: true });

  const anySvg = iconSvg({ shape: 'rounded', glyphScale: 1 });
  const maskableSvg = iconSvg({ shape: 'square', glyphScale: 0.78 });
  const appleSvg = iconSvg({ shape: 'square', glyphScale: 0.84 });

  await writeFile(join(iconsDir, 'icon.svg'), `${anySvg}\n`);

  await Promise.all([
    ...ICON_SIZES.map((size) => renderPng(anySvg, size, `icon-${size}x${size}.png`)),
    ...MASKABLE_SIZES.map((size) =>
      renderPng(maskableSvg, size, `icon-maskable-${size}x${size}.png`),
    ),
    renderPng(appleSvg, 180, 'apple-touch-icon-180x180.png'),
    renderPng(anySvg, 32, 'favicon-32x32.png'),
  ]);

  process.stdout.write(`Notes icons written to ${iconsDir}\n`);
}

await main();
