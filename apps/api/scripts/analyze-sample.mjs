import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const API_ROOT = resolve(import.meta.dirname, '..');
const DIST_DIR = resolve(API_ROOT, 'dist');
const ENV_FILES = [resolve(API_ROOT, '.env'), resolve(API_ROOT, '../../.env')];
const MODES = ['food_photo', 'nutrition_label', 'text'];
const DETAILS = ['low', 'high'];

const HELP = `Runs one real OpenAI analysis (single attempt, no retry) with the production prompt,
schema and normalization, and prints the normalized result, token usage and cost.

Usage:
  npm run ai:sample -w @food/api -- [image] [options]

Options:
  -m, --mode <mode>          food_photo | nutrition_label | text (default: food_photo with an image, else text)
  -d, --description <text>   what you ate, treated as ground truth
      --model <id>           model id (default: OPENAI_MODEL or gpt-5.6-sol)
      --precise              use OPENAI_PRECISE_MODEL (default gpt-6-astra)
      --split                text only: let the description be split into several meals
      --detail <level>       low | high (default: high)
      --raw                  also print the raw model JSON
  -h, --help                 show this help

Requires OPENAI_API_KEY (read from the environment, apps/api/.env or the repository .env)
and a build of the API (npm run build -w @food/api).`;

function fail(message) {
  console.error(`ai:sample: ${message}`);
  process.exit(1);
}

function loadEnvFiles() {
  for (const file of ENV_FILES) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
    }
  }
}

function readOptions() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mode: { type: 'string', short: 'm' },
      description: { type: 'string', short: 'd' },
      model: { type: 'string' },
      precise: { type: 'boolean', default: false },
      split: { type: 'boolean', default: false },
      detail: { type: 'string', default: 'high' },
      raw: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  const imagePath = positionals[0]
    ? resolve(process.env.INIT_CWD || process.cwd(), positionals[0])
    : null;
  const mode = values.mode ?? (imagePath ? 'food_photo' : 'text');
  const description = values.description?.trim() || null;
  if (!MODES.includes(mode)) {
    fail(`--mode must be one of ${MODES.join(', ')}`);
  }
  if (!DETAILS.includes(values.detail)) {
    fail(`--detail must be one of ${DETAILS.join(', ')}`);
  }
  if (mode === 'text' && imagePath) {
    fail('text mode does not take an image');
  }
  if (mode === 'text' && !description) {
    fail('text mode needs --description');
  }
  if (values.split && mode !== 'text') {
    fail('--split only works in text mode');
  }
  if (mode !== 'text' && !imagePath) {
    fail(`${mode} needs an image path`);
  }
  if (imagePath && !existsSync(imagePath)) {
    fail(`image not found: ${imagePath}`);
  }
  return { ...values, imagePath, mode, description };
}

function importDist(path) {
  const file = resolve(DIST_DIR, path);
  if (!existsSync(file)) {
    fail(
      `${file} is missing — build the API first: npm run build -w @food/api`,
    );
  }
  return import(pathToFileURL(file).href);
}

function localTimeNow() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

async function prepareImage(options) {
  if (!options.imagePath) {
    return null;
  }
  const { processPhoto } = await importDist('photos/photo-processing.js');
  const maxDimension = options.mode === 'nutrition_label' ? 2048 : 1024;
  const processed = await processPhoto(
    await readFile(options.imagePath),
    maxDimension,
  );
  console.error(
    `image: ${processed.width}×${processed.height} JPEG, ${processed.full.length} bytes`,
  );
  return {
    dataUrl: `data:image/jpeg;base64,${processed.full.toString('base64')}`,
    detail: options.detail,
  };
}

function chooseModel(options) {
  if (options.model) {
    return options.model;
  }
  return options.precise
    ? process.env.OPENAI_PRECISE_MODEL || 'gpt-6-astra'
    : process.env.OPENAI_MODEL || 'gpt-5.6-sol';
}

function costOf(models, model, usage, serviceTier) {
  const id = models.canonicalModelId(model);
  return models.computeCostUsd(
    id,
    usage,
    models.serviceTierMultiplier(id, serviceTier),
  );
}

async function main() {
  loadEnvFiles();
  const options = readOptions();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    fail('OPENAI_API_KEY is not set; refusing to run without a real key');
  }
  const [{ OpenAiProvider }, { normalizeAnalysis }, models] = await Promise.all(
    [
      importDist('ai/providers/openai.provider.js'),
      importDist('ai/normalize.js'),
      importDist('ai/models.js'),
    ],
  );
  const provider = new OpenAiProvider({
    apiKey,
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS) || 90_000,
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || 'low',
    serviceTier: process.env.OPENAI_SERVICE_TIER || 'default',
  });
  const model = chooseModel(options);
  const image = await prepareImage(options);
  const request = {
    model,
    images: image ? [image] : [],
    prompt: {
      mode: options.mode,
      description: options.description,
      localTime: localTimeNow(),
      mealType: null,
      location: null,
      answeredQuestions: [],
      followUp: null,
      imageRoles: image
        ? [options.mode === 'nutrition_label' ? 'label' : 'food']
        : [],
    },
  };
  console.error(
    `calling ${model} (${options.mode}${options.split ? ', split' : ''})…`,
  );
  try {
    if (options.split) {
      const { splitMeals } = await importDist('ai/meal-split.js');
      const response = await provider.analyzeMeals(request);
      const meals = splitMeals(response.raw, options.description).map(
        (meal) => ({
          description: meal.description,
          timing: meal.timing,
          result: normalizeAnalysis(meal.raw, { mode: options.mode }),
        }),
      );
      const costUsd = costOf(
        models,
        response.model,
        response.usage,
        response.serviceTier,
      );
      console.log(
        JSON.stringify(
          {
            model: response.model,
            requestId: response.requestId,
            serviceTier: response.serviceTier,
            latencyMs: response.latencyMs,
            usage: response.usage,
            costUsd,
            meals,
            ...(options.raw ? { raw: response.raw } : {}),
          },
          null,
          2,
        ),
      );
      for (const meal of meals) {
        const { mealType, time, daysAgo } = meal.timing;
        console.error(
          `${mealType ?? 'no meal named'} · ${time ?? 'no time'} · ${daysAgo} day(s) ago · ${meal.result.mealName} · ${meal.result.items.length} items · ${meal.result.totals.calories} kcal`,
        );
      }
      console.error(
        `${meals.length} meal(s) · ${costUsd === null ? 'unknown cost' : `$${costUsd.toFixed(4)}`} · ${(response.latencyMs / 1000).toFixed(1)} s`,
      );
      return;
    }
    const response = await provider.analyze(request);
    const result = normalizeAnalysis(response.raw, { mode: options.mode });
    const costUsd = costOf(
      models,
      response.model,
      response.usage,
      response.serviceTier,
    );
    console.log(
      JSON.stringify(
        {
          model: response.model,
          requestId: response.requestId,
          serviceTier: response.serviceTier,
          latencyMs: response.latencyMs,
          usage: response.usage,
          costUsd,
          result,
          ...(options.raw ? { raw: response.raw } : {}),
        },
        null,
        2,
      ),
    );
    console.error(
      `${result.items.length} items · ${result.totals.calories} kcal · ${costUsd === null ? 'unknown cost' : `$${costUsd.toFixed(4)}`} · ${(response.latencyMs / 1000).toFixed(1)} s`,
    );
  } catch (error) {
    const details = error?.details ?? {};
    const costUsd = details.usage
      ? costOf(
          models,
          details.model ?? model,
          details.usage,
          details.serviceTier,
        )
      : 0;
    console.error(
      JSON.stringify(
        {
          error: error?.kind ?? 'unknown',
          message: error instanceof Error ? error.message : String(error),
          retryable: error?.retryable ?? false,
          status: details.status ?? null,
          requestId: details.requestId ?? null,
          usage: details.usage ?? null,
          costUsd,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

await main();
