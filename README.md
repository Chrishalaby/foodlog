# FoodLog

A mobile-first PWA for logging what you eat from a photo, invite-only, for you and the people you let in. Snap your plate (or a nutrition label, or just
type what you ate), add an optional description such as *"2 patties ~150 g each, bun hollowed, 1 tbsp
ketchup-mayo"*, and an OpenAI vision model returns a structured, per-item nutrition estimate. Review and edit it,
save it, and track your day, week and trends on a dashboard.

- **Three input modes:** food photo (+ optional description), nutrition-label photo (you enter grams or servings
  eaten and the app computes totals), or text only.
- **Review before save:** every item is an editable card (name, grams, calories, protein, carbs, fat, saturated
  fat, fiber, sugar, sodium, alcohol). Changing grams rescales that item proportionally. You see the model's
  assumptions, and it can ask one follow-up question you can answer to re-run the estimate.
- **Search-first food memory:** everything you ever logged, and every food inside a meal, is searchable. Type
  "kho" and the Khoury yogurt you had last week shows up with last time's portion. One tap logs it, with no AI call and
  no cost. Your corrections stick, and you can star favorites.
- **Built-in food database:** 13,331 foods and dishes from USDA FoodData Central (public domain) with full
  nutrition, vitamins and household portions, searchable with typo tolerance and browsable by group. It shows up
  under your own foods in Log search, has its own page, and can add ingredients to any meal you build by hand. No AI
  or internet needed. See [docs/FOOD_DATABASE.md](docs/FOOD_DATABASE.md).
- **Barcode scanning:** a live camera scanner works on iPhone and Android. It checks your own products first, then
  Open Food Facts. If the product is unknown, you scan the nutrition label once and it's saved against the barcode,
  so the next scan is instant.
- **Quick edits on AI results:**
  - "How much did you eat?" portion chips for the whole meal
  - per-item portion chips and ± buttons
  - one-tap removal of AI-added cooking oil or sauces
  - **Correct the AI**: type what's wrong and it re-estimates with your correction as fact
- **First-login setup:** sex, age, height, weight and optional body fat % give you BMR, an estimated daily calorie
  burn (editable if your watch knows better), targets, BMI and FFMI.
- **Daily weight log:** a smoothed trend, weekly rate, and a **measured daily burn** calculated from your food log and
  weight trend (adaptive TDEE). You can adopt it with one tap.
- **History and favorites:** edit, delete or log again anything, any time.
- **Targets:** calculated from your profile (weight, height, age, sex, activity, goal):
  - calories (Mifflin-St Jeor, or Katch-McArdle when you enter body fat %; your own daily burn replaces the estimate when set)
  - protein by goal (1.6 g/kg for maintenance)
  - carbs and fat
  - limits: saturated fat, sodium, sugar
  - a fiber minimum

  You can override every target. A per-day **training day** toggle raises calories and carbs.
- **Dashboard:**
  - **Today:** progress rings plus limit bars, and a photo timeline.
  - **Week:** calories vs target, average macros, macro split, protein-hit days.
  - **Trends:** 30/90-day lines per nutrient, plus weekday averages.
  - **Insights:** rule-based (no AI cost).
- **Cost control:**
  - Images are compressed on the device, and the server re-encodes them and strips EXIF/GPS.
  - Strict Structured Outputs, at most one retry.
  - Every request is logged with tokens and cost, and monthly spend is shown in Settings.
  - Optional monthly budget cap and rate limits.
- **Accounts and admin:**
  - You stay logged in: sessions renew themselves and effectively never expire. You can sign out individual devices.
  - Other people **request access** from the login screen. You approve them in the **admin panel**, and they finish
    signing up on their own device, so no email service is needed. You can also invite people with a shareable link.
  - Admins manage people (roles, disable, reset link, sign out everywhere, delete) and set a **monthly AI budget per
    person**, since all analyses run on the owner's OpenAI key.
  - Admins see only per-person totals, never anyone's actual meals.
- **Bring your history:** import a FoodLog backup (JSON or CSV), a Cronometer food log or biometrics export, a
  MyFitnessPal nutrition or measurement summary, or any CSV of weigh-ins (Settings → Your data → Import). Files are
  read on your device, and anything already in your log is skipped, so importing twice is safe.
- **AI is optional:** without a key the app hides photo, label, voice and meal-idea estimates and leads with
  search, the food database, barcodes and manual entry. Add a key later and everything turns on.
- **Installable PWA:** dark mode by default, camera button on every screen, CSV/JSON export.

## Self-host quick start

Requirements: Docker with Compose. An OpenAI API key is optional: without one, FoodLog runs with search, the food
database, barcodes and manual entry, and hides the AI estimates.

```bash
git clone https://github.com/Chrishalaby/foodlog.git && cd foodlog
```

```bash
cp .env.example .env
```

Put a strong `POSTGRES_PASSWORD` (for example from `openssl rand -hex 32`) and, if you want AI estimates, your
`OPENAI_API_KEY` in `.env`, then:

```bash
docker compose up -d --build
```

```bash
docker compose logs app | grep -i "setup code"
```

Open http://localhost:3000 and create the first (admin) account with that setup code.

- **Phone access:** the live barcode scanner and home-screen install need HTTPS. Put the app behind Caddy, Traefik or
  a Cloudflare Tunnel and set `APP_URL` to that address.
- **Plain HTTP on your home network** (for example `http://192.168.1.20:3000`): set `COOKIE_SECURE=false`, or
  sign-in will not stick.
- **Prebuilt image:** instead of building on your server, set `FOODLOG_IMAGE` in `.env` to the image the release
  workflow publishes (`ghcr.io/chrishalaby/foodlog:latest`, amd64 and arm64), then run `docker compose pull` and
  `docker compose up -d`.
- **Updating:** `git pull`, then `docker compose up -d --build` (or `docker compose pull` with a prebuilt image).
  Migrations run on start.
- **Backups:** see [Backups and restore](#backups-and-restore).

## Live demo

Set `DEMO_MODE=true` to run a public demo, like the one on the project page. The sign-in page then offers
"Try the demo": every visitor gets a private sandbox account with two months of example meals (built from the food
database), weigh-ins, water and favorites, signed in on their device.

- AI estimates are simulated (`AI_PROVIDER` is forced to `mock`), so the demo costs nothing.
- Sandboxes are deleted after `DEMO_TTL_HOURS` (default 24), photos included. A visitor's IP can start at most 10
  sandboxes an hour.
- Sandbox accounts cannot change their password and are never admins.
- The food database must be loaded (it loads on start-up), otherwise visitors are asked to try again in a minute.

The project page lives in `site/` and is published to GitHub Pages by `.github/workflows/site.yml` (set Pages'
source to "GitHub Actions"). The workflow fills in the repository link, and the demo button appears once the
`DEMO_URL` repository variable points at a running demo.

## Other AI providers

FoodLog talks to any server that implements the OpenAI API. Set `AI_API_STYLE=chat` for servers that only offer
Chat Completions, and use a model that accepts images and JSON-schema output:

| Provider | `OPENAI_BASE_URL` | `OPENAI_API_KEY` | `OPENAI_MODEL` (example) |
|---|---|---|---|
| Ollama | `http://<host>:11434/v1` | any text, e.g. `ollama` | `qwen2.5vl:7b` or `gemma3:12b` |
| LM Studio | `http://<host>:1234/v1` | any text | the model id LM Studio shows |
| OpenRouter | `https://openrouter.ai/api/v1` | your OpenRouter key | `google/gemini-2.5-flash` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | your Gemini key | `gemini-2.5-flash` |

- Set `OPENAI_PRECISE_MODEL` too (the "precise re-check" model). Settings then lists exactly these two models.
- FoodLog does not know these models' prices, so their usage is recorded as $0 and budgets do not limit them.
- Small local vision models are much less accurate at portions than the defaults; the food database and your own
  saved foods keep logging accurate either way.
- Ollama and LM Studio have no speech-to-text endpoint: set `VOICE_ENABLED=false`, or point `TRANSCRIBE_BASE_URL`
  (and `TRANSCRIBE_API_KEY`, `OPENAI_TRANSCRIBE_MODEL`) at an OpenAI-compatible Whisper server.

## What leaves your server

- **To the AI endpoint** (OpenAI, or whatever `OPENAI_BASE_URL` points at): the photo you are logging (re-encoded,
  with EXIF and GPS removed), your description, the local time and meal type, the location you set in Settings (if
  any) and the names of your saved foods. Meal ideas also send your goal, targets, what you have eaten today and your
  usual foods. Requests are sent with `store: false`. Voice dictation sends the recording for transcription.
- **To Open Food Facts:** the barcode you scanned, when it is not one of your own products.
- **Nothing else.** No analytics, no telemetry, no account with anyone but your own server.

## How accuracy is handled

Research summary: portion size is the biggest error source for AI food estimates, and what you type matters more
than which model you pick. In published studies, adding stated amounts to the photo roughly halves the calorie error.
FoodLog is built around that finding:

- **Your description is ground truth.** Stated counts, weights, brands and preparation override what the image
  suggests.
- **Grams plus per-100 g values.** The model returns grams and per-100 g values (USDA FoodData Central style) for
  every item, and the server does all the multiplication and summing. The numbers always match the grams, and an
  edit rescales them exactly without another AI call.
- **Explicit food details.** Raw vs cooked vs dry weight is explicit per item. Cooking oil, butter, sauces and
  dressings are added as separate "assumed" items you can delete with one tap.
- **Server-side consistency checks** flag suspicious items:
  - calories vs macros (Atwater, ±15 %)
  - fiber or sugar greater than carbs
  - kJ reported as kcal (converted automatically)
- **Label photos are sent at higher resolution**, and per-100 g values are read exactly as printed:
  - kJ are converted to kcal
  - salt is converted to sodium
  - EU carbohydrate figures exclude fibre, so fibre is added back
- **Precise re-check.** Any result can be re-run once with the most accurate model.

### Models and cost

| Model | Role | Approx. cost / photo |
|---|---|---|
| `gpt-5.6-sol` (reasoning `low`) | **Default**: best measured vision accuracy among the fast models | ~$0.04 |
| `gpt-6-sol` | Newer, half the price, fewer hallucinations; worth A/B testing | ~$0.02 |
| `gpt-6-astra` | "Precise re-check" button: maximum accuracy, ~25 s | ~$0.10 |
| `gpt-5.6-luna` / `gpt-6-luna` | Budget options (weaker at portions) | ~$0.001–0.002 |

At 6 photos a day the default costs roughly **$7/month**. Switch models in **Settings → AI**, or set
`OPENAI_MODEL` on the server. Prices are hardcoded in `apps/api/src/ai/models.ts`. Update them there if OpenAI changes them.

## Stack

| Layer | Tech |
|---|---|
| Web | Angular 22 (standalone, zoneless, signals, Signal Forms), Tailwind CSS 4, Angular service worker (PWA), ngx-echarts / ECharts 6 |
| API | NestJS 12 (ESM), class-validator, `@nestjs/throttler`, cookie JWT auth (argon2id), sharp |
| AI | OpenAI Responses API via `openai` SDK 7, strict JSON-schema Structured Outputs (zod) |
| Data | PostgreSQL 17 + Prisma 7.10 (`@prisma/adapter-pg`) |
| Photos | Local disk or any S3-compatible bucket |
| Shared | `@food/shared`: API types, nutrient math, date helpers, target formulas used by both apps |

```
apps/api        NestJS API (also serves the built web app in production)
apps/web        Angular PWA
packages/shared shared types + pure logic
docs/           architecture & API contract
```

## Local development

Requirements: Node.js ≥ 24.9 (npm 11), Docker.

```bash
npm install
```

```bash
cp .env.dev.example .env
```

```bash
npm run db:up
```

```bash
npm run db:migrate
```

```bash
npm run dev
```

Open http://localhost:4200. The dev server proxies `/api` to the API on http://localhost:3000.

**First run:** the app asks you to create your account. It needs a one-time **setup code**: `SETUP_CODE` from
`.env`, or, when that is empty, a random code the API prints in its log (`No account yet — create it in the app with
setup code: …`). After the first account exists, setup is closed for good.

**AI without a key:** `AI_PROVIDER=mock` returns realistic simulated results at zero cost, so you can use the whole
app offline. To use OpenAI, set `AI_PROVIDER=openai` and `OPENAI_API_KEY=sk-...` in `.env` and restart the API.

**Try the real model on one photo** (after `npm run build -w @food/api`):

```bash
npm run ai:sample -w @food/api -- ./path/to/meal.jpg "2 eggs, 2 slices sourdough, 10 g butter"
```

**Testing on your phone:** the camera and PWA install need HTTPS (except on `localhost`). Deploy it (see below) or
put the dev server behind an HTTPS tunnel.

### Tests

```bash
npm test
```

```bash
npm run test:e2e
```

- `npm test` runs the shared, API and web unit tests.
- `npm run test:e2e` runs the API end-to-end tests. They use the `food_test` database in the dev Postgres, and the
  database is created and migrated automatically. Set `E2E_DB_NAME` to use a different database.
- GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, unit tests and e2e tests on every push to `main` and on
  pull requests.
- The Docker image build does not run the tests. On Railway, **Wait for CI** (see [Railway](#railway)) keeps a commit
  whose CI failed from deploying.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `PORT` | `3000` | HTTP port (Railway sets it automatically) |
| `HOST` | `::` | Address to listen on; use `0.0.0.0` on hosts without IPv6 |
| `NODE_ENV` | `development` | `production` enables secure cookies |
| `COOKIE_SECURE` | `auto` | `true`/`false`/`auto` (auto = production). Set `false` only when serving plain HTTP on a non-localhost host |
| `JWT_SECRET` | *(auto)* | Session signing secret (≥ 32 chars). If empty, one is generated once and stored in the database |
| `SETUP_CODE` | *(auto)* | One-time code required to create the first (admin) account. If empty, a random one is printed in the log |
| `ADMIN_EMAILS` | — | Comma-separated emails that are always admins (e.g. `admin@example.com`) |
| `APP_URL` | *(request origin)* | Public URL used in invite/reset links, e.g. `https://foodlog.example.com` |
| `AI_MEMBER_MONTHLY_BUDGET_USD` | `5` | Default monthly AI budget for non-admin members (overridable per person in the admin panel). Leave it out for $5; set it to an empty value or `unlimited` for no member limit |
| `AI_PROVIDER` | `openai` | `openai` or `mock` |
| `OPENAI_API_KEY` | — | Server-side only; never sent to the browser |
| `OPENAI_BASE_URL` | *(OpenAI)* | Another OpenAI-compatible server; see [Other AI providers](#other-ai-providers) |
| `AI_API_STYLE` | `responses` | `responses` (OpenAI Responses API) or `chat` (Chat Completions, for Ollama, LM Studio, OpenRouter, Gemini…) |
| `VOICE_ENABLED` | `true` | `false` hides voice dictation |
| `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_API_KEY` | *(same as AI)* | A separate OpenAI-compatible speech-to-text server for voice dictation |
| `OPENAI_MODEL` | `gpt-5.6-sol` | Default analysis model (overridable per user in Settings) |
| `OPENAI_PRECISE_MODEL` | `gpt-6-astra` | Model for "precise re-check" |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-transcribe` | Speech-to-text model for voice dictation (`POST /api/transcribe`) |
| `OPENAI_REASONING_EFFORT` | `low` | Reasoning effort (`low` is the accuracy/latency sweet spot) |
| `OPENAI_SERVICE_TIER` | `default` | `fast` = ~2× faster at 2× price |
| `OPENAI_TIMEOUT_MS` | `90000` | Per-attempt timeout |
| `AI_RATE_LIMIT_PER_MINUTE` / `AI_RATE_LIMIT_PER_HOUR` | `6` / `60` | Analyze endpoint rate limits |
| `AI_MONTHLY_BUDGET_USD` | — | Optional hard monthly spend cap for everyone combined |
| `NOTES_ENABLED` | `false` | Turn on Notes, the notes-to-self app at `/notes` |
| `DEMO_MODE` | `false` | Public demo with per-visitor sandboxes; see [Live demo](#live-demo) |
| `DEMO_TTL_HOURS` | `24` | How long a demo sandbox lives (1–168) |
| `CATALOG_AUTOLOAD` | `true` | Load or update the built-in food database on start-up (`false` in tests) |
| `CATALOG_FILE` | *(bundled)* | Use another build of the food database file |
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `PHOTOS_DIR` | `./data/photos` | Local photo directory |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | — | S3-compatible storage (AWS, Railway Buckets, R2, MinIO…) |
| `WEB_DIST_DIR` | *(auto)* | Where the built web app is served from |

## Deploy

### Docker Compose (app + Postgres)

```bash
cp .env.example .env
```

Set these in `.env`:

- `OPENAI_API_KEY`.
- `APP_URL` (the public HTTPS URL, used in invite and reset links) and optionally `ADMIN_EMAILS`.
- A strong, URL-safe `POSTGRES_PASSWORD` **before the first start**, e.g. from `openssl rand -hex 32`. It is also put
  into the app's `DATABASE_URL`, so avoid characters that need URL encoding.
- Optionally `SETUP_CODE` and `JWT_SECRET` (e.g. from `openssl rand -base64 48`; one is generated when empty).

Then:

```bash
docker compose up -d --build
```

The app listens on port 3000 (`APP_PORT`) and runs database migrations on start. Photos are kept in the `appdata`
volume. Put it behind HTTPS (Caddy, Traefik, Cloudflare Tunnel…) so the camera and PWA install work on your phone.
Find the first-account setup code with `docker compose logs app | grep -i "setup code"`.

- Postgres is published only on `127.0.0.1:${DB_PORT}` (default 5433) for local tools; the app reaches it at
  `db:5432` inside the Compose network.
- `POSTGRES_PASSWORD` only takes effect when the `pgdata` volume is first created. To change it later, run
  `docker compose exec db psql -U food -d food -c "ALTER USER food WITH PASSWORD '...'"`, update `.env`, then
  recreate the app with `docker compose up -d app`.
- On stop or redeploy the app gets up to 200 s to finish in-flight AI analyses before it is killed.

### Railway

The repo deploys as a single Docker service (API plus the web app) with a Railway Postgres database:

1. Create a project with a **PostgreSQL** database.
2. Add a service from this GitHub repo. Railway builds the root `Dockerfile`.
3. Set the service variables:
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - `NODE_ENV=production`
   - `AI_PROVIDER=openai`
   - `OPENAI_API_KEY`
   - `ADMIN_EMAILS`, `APP_URL=https://<your domain>`, and optionally `AI_MONTHLY_BUDGET_USD` /
     `AI_MEMBER_MONTHLY_BUDGET_USD`
4. Choose photo storage:
   - **Cloudflare R2 (used by the live app):** create a bucket and an R2 API token with Object Read & Write on that
     bucket, then set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION=auto`,
     `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_FORCE_PATH_STYLE=true`, `S3_ACCESS_KEY_ID` and
     `S3_SECRET_ACCESS_KEY`.
   - **Railway Bucket:** add a Bucket and set `STORAGE_DRIVER=s3` plus the `S3_*` variables from its credentials.
   - **Volume:** attach a volume at `/app/data` and set `RAILWAY_RUN_UID=0`. Railway mounts volumes as root and the
     image otherwise runs as the non-root `node` user, which cannot write photos there. This keeps the default
     `PHOTOS_DIR=/app/data/photos`.
5. Set the health check path to `/api/health` and generate a public domain.
6. Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=200` so a redeploy lets in-flight AI analyses finish (Railway's default of
   0 s kills them at once). Keep it at least `2 × OPENAI_TIMEOUT_MS / 1000 + 10`. With a volume attached,
   deployments cannot overlap, so each deploy has a short downtime; bucket storage avoids that.
7. Once GitHub Actions is enabled for the repo, turn on **Wait for CI** under the service's Settings → Source so
   Railway only deploys commits whose CI passed.
8. Open the domain. Copy the setup code from the deploy logs (or set `SETUP_CODE`), then create your account.
9. Install to your home screen:
   - **iOS:** Safari → Share → Add to Home Screen.
   - **Android:** Chrome → Install app.
10. Optional, Notes as a second installable app: Android only gives each web app its own window per address, so
    Notes needs its own. Add an empty service (for example `notes`), set `UPSTREAM` to
    `http://${{foodlog.RAILWAY_PRIVATE_DOMAIN}}:8080` (the app service's private address and port), deploy
    `deploy/notes-proxy` to it (`railway up ./deploy/notes-proxy --path-as-root --service notes`) and generate a
    domain whose first label contains `notes` (for example `foodlog-notes.example.com`). That address serves
    Notes only, with the same accounts and data.

`GET /api/health` reports the running version as `{package version}+{first 7 characters of the commit}` (from
`RAILWAY_GIT_COMMIT_SHA`), so you can tell which commit is live. Without a commit it reports the package version.

### Backups and restore

Your meals, weights and accounts live only in Postgres, and photos live in the bucket.

- **Postgres on Railway:** open the Postgres service → **Backups** and turn on scheduled backups (daily and weekly).
  A backup can be restored from the same tab; Railway restores it into the service volume.
- **Your own copy:** Settings → Data → **Export JSON** downloads everything you logged. For a full database dump,
  run `pg_dump` against the database's public connection URL (Railway shows it under the Postgres service's
  Connect tab):

```bash
pg_dump --format=custom --no-owner --file foodlog-$(date +%F).dump "$DATABASE_PUBLIC_URL"
```

  and restore it with `pg_restore --clean --no-owner --dbname "$TARGET_DATABASE_URL" foodlog-YYYY-MM-DD.dump`.
- **Photos:** R2 keeps objects until deleted. Copy the bucket with any S3 tool (`rclone`, `aws s3 sync`) if you want
  an offsite copy.
- **Docker Compose:** dump the database with `docker compose exec -T db pg_dump -U food -d food --format=custom >
  foodlog-$(date +%F).dump`, and copy the photos out of the `appdata` volume (`docker compose cp app:/app/data ./foodlog-data`).

## License

Food data: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov
(public domain, CC0 1.0).

FoodLog is free software under the [GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified
version as a service for other people, you must offer them its source code.
