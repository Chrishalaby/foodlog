import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const publicDir = join(import.meta.dirname, '..', 'public');
const iconsDir = join(publicDir, 'icons');

const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const MASKABLE_SIZES = [192, 512];
const BRAND_LIGHT = '#5ee89a';
const BRAND_DARK = '#118a3f';
const MARK_COLOR = '#ffffff';

function markPaths(midribColor) {
  return [
    `<circle cx="256" cy="256" r="150" fill="none" stroke="${MARK_COLOR}" stroke-width="30"/>`,
    `<path d="M176 336C158 246 218 162 336 176C350 294 266 354 176 336Z" fill="${MARK_COLOR}"/>`,
    `<path d="M190 322L292 220" fill="none" stroke="${midribColor}" stroke-width="14" stroke-linecap="round"/>`,
  ].join('');
}

function logoSvg({ shape, markScale }) {
  const background =
    shape === 'rounded'
      ? '<rect width="512" height="512" rx="116" fill="url(#bg)"/>'
      : '<rect width="512" height="512" fill="url(#bg)"/>';
  const offset = 256 * (1 - markScale);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${BRAND_LIGHT}"/>`,
    `<stop offset="1" stop-color="${BRAND_DARK}"/>`,
    '</linearGradient>',
    '</defs>',
    background,
    `<g transform="translate(${offset} ${offset}) scale(${markScale})">`,
    markPaths('#1a9c4c'),
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

  const anySvg = logoSvg({ shape: 'rounded', markScale: 1 });
  const maskableSvg = logoSvg({ shape: 'square', markScale: 0.8 });
  const appleSvg = logoSvg({ shape: 'square', markScale: 0.84 });

  await writeFile(join(publicDir, 'favicon.svg'), `${anySvg}\n`);

  await Promise.all([
    ...ICON_SIZES.map((size) => renderPng(anySvg, size, `icon-${size}x${size}.png`)),
    ...MASKABLE_SIZES.map((size) =>
      renderPng(maskableSvg, size, `icon-maskable-${size}x${size}.png`),
    ),
    renderPng(appleSvg, 180, 'apple-touch-icon-180x180.png'),
  ]);

  await sharp(Buffer.from(anySvg), { density: 384 })
    .resize(32, 32)
    .png({ compressionLevel: 9 })
    .toFile(join(publicDir, 'favicon-32x32.png'));

  process.stdout.write(`Icons written to ${iconsDir}\n`);
}

await main();
