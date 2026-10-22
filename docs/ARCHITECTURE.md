# FoodLog — architecture & contract

Small multi-user (invite-only, owner/admin + members), mobile-first PWA: photograph food (or a nutrition label, or type a description), a vision
model (OpenAI, Claude or any OpenAI-compatible server) returns structured nutrition estimates, the user reviews/edits, saves, and tracks daily/weekly nutrition.

## Repository layout (npm workspaces)

```
package.json                 root scripts, workspaces: packages/*, apps/*
docker-compose.yml           self-host stack (Postgres + app; `FOODLOG_IMAGE` picks a prebuilt image)
.env                         dev env (git-ignored) — read by the API and by Prisma
packages/shared              @food/shared — TS types (API contract), enums, nutrient math, date utils, target formulas
apps/api                     @food/api — NestJS 12 (ESM), Prisma 7.10 + PostgreSQL 17, OpenAI SDK 7, Anthropic SDK
apps/web                     @food/web — Angular 22.2 (standalone, zoneless, OnPush default, signals), Tailwind 4, PWA
deploy/notes-proxy           Caddy image that gives Notes its own address in front of the same service
apps/api/catalog             the built-in food database file (`usda-foods.json.gz`), loaded on start
site/                        static project page, published to GitHub Pages by `.github/workflows/site.yml`
docs/                        this file, FOOD_DATABASE.md
```

`@food/shared` is compiled to `packages/shared/dist` (ESM + d.ts). After changing it run `npm run build -w @food/shared`.
Both apps import it as `import { ... } from '@food/shared'`. **All API request/response shapes live in
`packages/shared/src/api.ts`. Do not redefine them; import them.** If a shape must change, change it there (lead only).

## Global engineering rules

- **Zero code comments.** No `//`, `/* */`, JSDoc, TODO, banner or section comments in any file you create or edit
  (TS, HTML, CSS, SCSS, JSON-with-comments, Prisma, YAML, Dockerfile). Generated boilerplate comments must be removed.
  Put explanations in commit messages / docs / test names instead.
- TypeScript strict everywhere. No `any` unless unavoidable at a library boundary.
- Keep functions small and names descriptive. Match the surrounding code style (Prettier defaults of each app:
  web `printWidth 100, singleQuote`; api `singleQuote, trailingComma all`).
- Never run `npm install` / add dependencies. All needed dependencies are already installed at the root. If you
  truly need a new package, stop and report it.
- Never touch files owned by another work stream (see ownership in the task prompt). Never edit `packages/shared`
  unless you are the lead.
- Never commit, push, or change git config.

## API (apps/api)

NestJS 12 **ESM** project (`"type": "module"`): relative imports **must** end in `.js`
(`import { X } from './x.service.js'`); use `import.meta.dirname` instead of `__dirname`. TypeScript 6 (do not use 7).
Tests: Vitest 4 (`npm test -w @food/api`, e2e: `npm run test:e2e -w @food/api`). Build: `npm run build -w @food/api`.
Typecheck: `npm run typecheck -w @food/api`.

Prisma 7.10 (`prisma-client` generator, output `src/generated/prisma`, import from `../generated/prisma/client.js`
and enums from `../generated/prisma/enums.js`). Config file `apps/api/prisma7.config.ts` (loads `.env` and
`../../.env`). Driver adapter `@prisma/adapter-pg`. `prisma migrate dev` does NOT regenerate the client — run
`npx prisma generate` (from `apps/api`) after schema changes. Nutrient columns are `Float`; dates are `Timestamptz(3)`;
ids are `uuid(7)` generated client-side. Json writes need `as Prisma.InputJsonValue`.

Global setup (`src/app.setup.ts`, used by `main.ts` and e2e tests): `trust proxy 1`, global prefix `api`,
cookie-parser, JSON body limit 1mb, global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`,
shutdown hooks. Global guards: `ThrottlerGuard` and `JwtAuthGuard` (every route requires auth unless decorated
`@Public()`); `@CurrentUser()` param decorator yields `{ id: string; email: string }`.

Every query must be scoped to the current user's id (`where: { userId }`) and return 404 for other users' rows.

### Endpoints (all JSON unless noted; types from `@food/shared`)

| Method | Path | Body / query | Response | Notes |
|---|---|---|---|---|
| GET | /api/health | — | `HealthResponse` | public, no throttle |
| GET | /api/auth/status | — | `AuthStatusResponse` | public |
| POST | /api/auth/setup | `SetupRequest` | `UserDto` + cookie | public; 409 if an account exists; 403 wrong setup code; throttle 5/min |
| POST | /api/auth/login | `LoginRequest` | `UserDto` + cookie | public; 401 invalid; throttle 5/min |
| POST | /api/auth/logout | — | 204, clears cookie | |
| POST | /api/auth/change-password | `ChangePasswordRequest` | 204 | 400 wrong current password |
| POST | /api/analyze | multipart: optional file `image` + `AnalyzeRequestFields` | `AnalyzeResponse` | AI rate limit; see AI section; `split=true` may return several meals |
| GET | /api/photos/:id | — | `image/jpeg` | owner only; `Cache-Control: private, max-age=31536000, immutable` |
| GET | /api/photos/:id/thumb | — | `image/webp` | same |
| GET | /api/entries | `EntryListQuery` | `EntryListResponse` | see Entries |
| GET | /api/entries/:id | — | `EntryDto` | |
| GET | /api/entries/:id/raw-ai | — | `EntryRawAiResponse` | raw model JSON for debugging (`null` if none) |
| POST | /api/entries | `CreateEntryRequest` | `EntryDto` (201) | |
| PUT | /api/entries/:id | `UpdateEntryRequest` | `EntryDto` | full replacement of fields + items |
| DELETE | /api/entries/:id | — | 204 | |
| POST | /api/entries/:id/duplicate | `DuplicateEntryRequest` | `EntryDto` (201) | "Log again" |
| GET | /api/favorites | — | `FavoriteDto[]` | sorted useCount desc, lastUsedAt desc, name |
| POST | /api/favorites | `CreateFavoriteRequest` | `FavoriteDto` (201) | |
| POST | /api/favorites/from-entry/:entryId | `CreateFavoriteFromEntryRequest` | `FavoriteDto` (201) | name defaults to entry name |
| PUT | /api/favorites/:id | `UpdateFavoriteRequest` | `FavoriteDto` | |
| DELETE | /api/favorites/:id | — | 204 | |
| POST | /api/favorites/:id/log | `LogFavoriteRequest` | `EntryDto` (201) | one-tap log, no AI |
| GET | /api/days/:date | — | `DayMetaDto` | missing row → `trainingDay: false` |
| PUT | /api/days/:date | `UpdateDayMetaRequest` | `DayMetaDto` | upsert |
| GET | /api/profile | — | `ProfileResponse` | creates default profile row if missing |
| PUT | /api/profile | `UpdateProfileRequest` | `ProfileResponse` | |
| GET | /api/dashboard/day | `?date=YYYY-MM-DD` | `DayDashboardResponse` | entries sorted timestamp asc |
| GET | /api/dashboard/range | `?from=&to=` | `RangeDashboardResponse` | one `DaySummary` per date (incl. empty days); max 366 days |
| GET | /api/insights | `?to=YYYY-MM-DD&days=7` | `InsightsResponse` | days 7–90, default 7 |
| GET | /api/usage | `?month=YYYY-MM` | `UsageSummaryResponse` | default: current UTC month |
| GET | /api/foods | `FoodSearchQuery` (`q`, `limit` ≤ 50, `scope`) | `FoodSearchResponse` | personal food library search; empty `q` = frequent & recent; `scope=standalone` leaves out parts of meals |
| POST | /api/foods/log | `QuickLogRequest` | `EntryDto` (201) | one-tap log of a library result, no AI |
| POST | /api/foods/rename | `FoodRenameRequest` | `FoodRenameResponse` | rename every own entry with that (normalized) name; `dryRun` only counts |
| GET | /api/foods/hidden | — | `HiddenFoodsResponse` | names removed from suggestions |
| POST | /api/foods/hidden | `HideFoodRequest` | `HiddenFoodsResponse` | hide a name from suggestions (logs are kept) |
| DELETE | /api/foods/hidden | `?name=` | `HiddenFoodsResponse` | unhide |
| GET | /api/weights | `?from=&to=` | `WeightSummaryResponse` | weigh-ins, trend, weekly change, adaptive TDEE |
| PUT | /api/weights/:date | `UpsertWeightRequest` | `WeightLogDto` | upsert one weigh-in per local date |
| DELETE | /api/weights/:date | — | 204 | |
| POST | /api/access-requests | `CreateAccessRequest` | `CreateAccessRequestResponse` (202) | public; 5/hour per IP; identical response whether or not the email exists |
| POST | /api/access-requests/status | `AccessRequestStatusRequest` | `AccessRequestStatusResponse` | public; unknown token → `status: 'unknown'` |
| POST | /api/access-requests/accept | `AcceptAccessRequest` | `UserDto` + cookie | public; only when approved and no account exists for the email |
| GET | /api/auth/tokens/:token | — | `AuthTokenInfoResponse` | public; invite / reset links |
| POST | /api/auth/tokens/:token/accept | `AcceptAuthTokenRequest` | `UserDto` + cookie | public; invite → creates the account; reset → sets the password and revokes other sessions |
| GET | /api/auth/sessions | — | `SessionDto[]` | own signed-in devices |
| DELETE | /api/auth/sessions/:id | — | 204 | revoke one of own sessions |
| PUT | /api/auth/account | `UpdateAccountRequest` | `UserDto` | own display name |
| GET | /api/admin/overview | — | `AdminOverviewResponse` | admin only (403 otherwise) |
| GET | /api/admin/users | — | `AdminUserDto[]` | admin |
| PATCH | /api/admin/users/:id | `UpdateAdminUserRequest` | `AdminUserDto` | admin; cannot demote/disable yourself or the last active admin |
| POST | /api/admin/users/:id/reset-link | — | `InviteLinkResponse` | admin; password-reset link |
| POST | /api/admin/users/:id/revoke-sessions | — | 204 | admin |
| DELETE | /api/admin/users/:id | — | 204 | admin; deletes the user, all their data and photos; never yourself |
| GET | /api/admin/access-requests | `?status=` | `AdminAccessRequestDto[]` | admin |
| POST | /api/admin/access-requests/:id/approve | — | `InviteLinkResponse` | admin; marks approved and creates an invite link |
| POST | /api/admin/access-requests/:id/reject | — | `AdminAccessRequestDto` | admin |
| GET | /api/admin/invites | — | `AdminInviteDto[]` | admin |
| POST | /api/admin/invites | `CreateInviteRequest` | `InviteLinkResponse` (201) | admin; "add people" |
| POST | /api/admin/invites/:id/regenerate | — | `InviteLinkResponse` | admin; new link, old one revoked |
| DELETE | /api/admin/invites/:id | — | 204 | admin; revoke |
| GET | /api/admin/ai-provider | — | `AiProviderResponse` | admin; never contains a key, only `hasApiKey` + last 4; see AI provider setup |
| PUT | /api/admin/ai-provider | `UpdateAiProviderRequest` | `AiProviderResponse` | admin; 409 when the environment sets AI, 403 in `DEMO_MODE` |
| DELETE | /api/admin/ai-provider | — | `AiProviderResponse` | admin; forgets the saved provider and its keys |
| POST | /api/admin/ai-provider/test | `UpdateAiProviderRequest` | `TestAiProviderResponse` | admin; one tiny structured request, nothing saved; 20/min |
| GET | /api/drafts | — | `DraftDto[]` | own drafts, newest first |
| POST | /api/drafts | multipart `CreateDraftFields` + `images` | `DraftDto` (201) | save for later (photos stored like analyze uploads) |
| PUT | /api/drafts/:id | `UpdateDraftRequest` | `DraftDto` | |
| DELETE | /api/drafts/:id | — | 204 | photos deleted when unreferenced |
| POST | /api/drafts/:id/log | `LogDraftRequest` | `EntryDto` (201) | creates the entry (photo, analysis link, raw AI json) and deletes the draft atomically |
| POST | /api/compare/menu | multipart `MenuScanFields` + `images` (≤ 3) | `MenuScanResponse` | AI menu extraction, counts toward AI budgets and rate limits |
| POST | /api/meal-ideas | `MealIdeasRequest` | `MealIdeasResponse` | AI ideas for what to eat next from the usual foods and what is left today; AI budgets and rate limits apply; see AI meal ideas |
| POST | /api/transcribe | multipart file `audio` (≤ `API_LIMITS.audioMaxBytes`) | `TranscribeResponse` | voice dictation to text; AI budgets apply, own rate limit |
| GET | /api/products/barcode/:code | — | `BarcodeLookupResponse` | own product first, else Open Food Facts (saved to own products) |
| PUT | /api/products/barcode/:code | `UpsertProductRequest` | `ProductDto` | save/correct a product (e.g. from a label scan) |
| GET | /api/products | — | `ProductDto[]` | own products |
| DELETE | /api/products/:id | — | 204 | |
| POST | /api/products/:id/log | `LogProductRequest` | `EntryDto` (201) | log grams or servings, no AI |
| GET | /api/my-foods | `MyFoodsQuery` (`q`) | `MyFoodDto[]` | saved foods (all own products, with or without barcode), most used first |
| POST | /api/my-foods | `SaveMyFoodRequest` | `MyFoodDto` (201) | create a saved food (manual, from an item, from a label) |
| PUT | /api/my-foods/:id | `UpdateMyFoodRequest` | `MyFoodChangeResponse` | edit; `applyToPast` recomputes linked items |
| DELETE | /api/my-foods/:id | — | 204 | past items keep their values and lose the link |
| GET | /api/my-foods/suggestions | — | `FoodMergeSuggestionsResponse` | likely duplicates with inconsistent values, best first |
| POST | /api/my-foods/merge | `MergeFoodsRequest` | `MyFoodChangeResponse` (201) | make several names one saved food |
| POST | /api/my-foods/suggestions/dismiss | `DismissFoodMergeRequest` | 204 | never suggest that group again |
| GET | /api/fluids | `?date=` (logical local date) | `FluidDayResponse` | fluid logs + drinks inside meals for one day, target, caffeine |
| POST | /api/fluids | `CreateFluidLogRequest` | `FluidLogDto` (201) | quick water/coffee/tea/other |
| PUT | /api/fluids/:id | `UpdateFluidLogRequest` | `FluidLogDto` | |
| DELETE | /api/fluids/:id | — | 204 | |
| GET | /api/notes | `NoteListQuery` (`q`, `status`, `before`, `limit` ≤ 100) | `NoteListResponse` | notes to self, newest first; see Notes |
| POST | /api/notes | multipart `CreateNoteFields` + `images` (≤ 4), or JSON `{ text }` | `NoteDto` (201) | 400 without text and photos; 60/min |
| PATCH | /api/notes/:id | `UpdateNoteRequest` | `NoteDto` | edit text, tick off / reopen |
| DELETE | /api/notes/:id | — | 204 | photos deleted when unreferenced |
| GET | /api/export | `?format=json\|csv` | file download | `Content-Disposition: attachment` |
| GET | /api/catalog | — | `CatalogInfoResponse` | built-in food database: version, size, groups, source, license |
| GET | /api/catalog/foods | `CatalogSearchQuery` (`q`, `group`, `limit` ≤ 50, `offset` ≤ 10000) | `CatalogSearchResponse` | ranked search, or A–Z browse without `q`; see Food database |
| GET | /api/catalog/foods/:id | — | `CatalogFoodDto` | 404 unknown id |
| POST | /api/import | `ImportBatchRequest` | `ImportBatchResponse` | one chunk of an import; duplicates skipped; see Import |
| POST | /api/demo/start | `DemoStartRequest` | `UserDto` + cookie | public; 404 unless `DEMO_MODE`; 10/hour per IP; see Demo mode |

Validation errors → 400 with Nest's default body (`ApiError`). Unknown/foreign ids → 404.

### Domain rules

- **Local dates are client-authoritative.** Every entry stores `timestamp` (instant, ISO string from the client) and
  `localDate` (`YYYY-MM-DD` in the device's timezone at that instant, computed by the client). All day grouping uses
  `localDate`. Validate with `isValidLocalDate` from `@food/shared`.
- **Totals are always recomputed server-side** from items: item nutrients are `sanitizeNutrients` →
  `roundNutrients`; entry/favorite totals = `roundNutrients(sumNutrients(items))`. Never trust client totals.
- Item limits: 1–`API_LIMITS.itemsMax` items; `grams` 0–`MAX_ITEM_GRAMS`; each nutrient 0–`NUTRIENT_META[k].max`;
  names 1–`API_LIMITS.nameMax` chars.
- `EntryDto.items` sorted by `position` (0-based, the array order sent by the client).
- `PhotoRef.url` = `/api/photos/{id}`, `thumbUrl` = `/api/photos/{id}/thumb`.
- Entry photos: an entry keeps ALL its photos as `EntryPhoto` rows (role food | label, position) and exposes them as
  `EntryDto.photos` (ordered); `Entry.photoId` / `EntryDto.photo` is the cover shown on cards (default: first food
  photo, else first photo). Creating from an analysis copies every analysis photo; `photoId`/`coverPhotoId` on create
  pick the cover (must be one of the entry's photos); `PUT /api/entries/:id` accepts `coverPhotoId` to change it.
  Log again, quick log of a meal, favorite logs (their single photo) and draft logs copy all photos. `EntryPhoto`
  counts as a photo reference for deletion and cleanup; deleting an entry releases all its photos.
- Photo sizing (web and API use `fitToPatchBudget` from `@food/shared`): every analysis photo is resized so that
  ceil(w/32) × ceil(h/32) ≤ 2400 patches and the long side ≤ 2048 px — the most detail OpenAI's `high` detail level
  keeps — e.g. 1340×1786 for a 12 MP 3:4 photo, 1152×2048 for 9:16; JPEG q85 (q88 on the device), 4:4:4 chroma for
  labels and menus.
- Photos: uploads are re-encoded server-side with sharp (`rotate()` for EXIF orientation, strip all metadata incl.
  GPS, sized with `fitToPatchBudget` (see "Photo sizing"), JPEG q85 mozjpeg, 4:4:4 chroma for labels/menus) plus a 320 px WebP thumbnail (q70).
  Only these compressed versions are stored. Storage driver `local` (dir `PHOTOS_DIR`) or `s3` (S3-compatible).
  A photo may be shared by several entries/favorites/analyses (log-again, favorites). A photo file is deleted
  only when nothing references it any more (`PhotosService.deleteIfUnreferenced`). An hourly cleanup deletes
  analyses older than 7 days that no entry references, then photos with zero references older than 24 h.
- `Entry.rawAiJson` stores the raw model JSON of the analysis the entry was created from (debugging).
- Log again (`duplicate`): copies name, description, mealType (unless overridden), items, photo reference,
  rawAiJson; `source = 'copy'`, new timestamp/localDate, `analysisId = null`.
- Favorite log: items scaled by `servings` (default 1); entry name = favorite name, or `"{name} ×{servings}"` when
  servings ≠ 1; `source = 'favorite'`, `favoriteId` set, photo reused; increments `useCount`, sets `lastUsedAt`.
- Deleting an entry: delete row (items and EntryPhoto rows cascade), then `deleteIfUnreferenced` for every photo it had.

### Food library (search-first logging)

Every saved entry and every item inside it is automatically part of the user's personal food library; favorites
are "starred" library items. `GET /api/foods?q=` returns up to `limit` (default 20, max `API_LIMITS.foodSearchMax`)
`FoodSearchResult`s of three kinds, deduplicated by normalized name (lowercase, trimmed, collapsed whitespace,
diacritics stripped) with precedence favorite > meal > food:
- `favorite` — key `favorite:{id}`; items/totals from the favorite; `starred: true`.
- `meal` — key `meal:{entryId}` of the most recent entry with that name; items/totals/photo/mealType from it;
  `useCount` = number of entries with that normalized name; `lastUsedAt` = latest timestamp.
- `food` — key `food:{entryItemId}` of the most recent entry item with that name (single-item results, e.g. a
  yogurt that was part of a bigger meal); `detail` = the entry name it came from; `useCount` = occurrences.
Matching: every whitespace-separated token of `q` must be a substring of the normalized name (or detail);
ranking = exact name > name prefix > word prefix > substring, then log(useCount), recency, starred. Empty `q`:
starred favorites first (by useCount), then the most frequent/recent meals and foods of the last 90 days.
`POST /api/foods/log` resolves `key` for the current user (404 if gone): favorites behave exactly like
`/favorites/:id/log` (servings, useCount++, lastUsedAt); meals copy the source entry (items scaled by `servings`,
photo reused, rawAiJson copied, `source: 'copy'`); foods create a single-item entry named after the item. `grams`
(single-item results only) overrides `servings` by scaling the item to that weight. User corrections persist
naturally because results always come from what was actually saved.
One logged thing must appear once: `food` candidates come only from items inside entries with 2+ items; a single-item
entry is represented by its `meal` result, whose `detail` is the item's name when it differs from the entry name
(search matches detail). Renaming: the web entry form keeps a single item's name in sync with the meal name, and after
renaming an entry whose old name is shared by other entries it offers `POST /api/foods/rename` (entries whose normalized
name equals `from` get `to`; in single-item entries the item is renamed too when its normalized name equals `from`).
Hidden names (`Profile.hiddenFoods`, normalized, ≤ 500) are excluded from meal/food suggestions and search (favorites
and products are unaffected); logs are never deleted.
`scope=standalone` (`FOOD_SEARCH_SCOPES`, default `all`) returns only things that were eaten on their own: favorites,
meals, and saved foods/products — without `food` results (items that only ever appeared inside bigger meals: table
salt, a bun) and without saved foods whose every linked item sits in a multi-item entry (ketchup, mayo). A saved food
that was never logged, or logged at least once as a single-item entry, stays. Owner report: "I won't be eating ketchup
alone" — Compare uses this scope; the Log search keeps `all` so a part of a meal can still be re-logged by itself. Library photo uploads prefill the meal time from the photo's
EXIF DateTimeOriginal (when present and not in the future), shown as "Time from photo", editable.

### Food database (USDA catalog)

A shared, read-only database of 13,331 foods and dishes (USDA FoodData Central: Foundation Foods, SR Legacy, FNDDS;
public domain) lives in `CatalogFood` (id = USDA fdcId, source, name, normalized `searchName`, category, `group`,
per-100 g nutrient columns, `missing` nutrient keys, `microsPer100` JSON, `portions` JSON `{ label, grams }[]`) and
`CatalogDataset` (loaded version). It is not per user. Full details: `docs/FOOD_DATABASE.md`.
- Build: `apps/api/scripts/build-food-catalog.mjs` turns the three USDA JSON downloads into
  `apps/api/catalog/usda-foods.json.gz` (shipped in the image). `CatalogLoaderService` reads it on bootstrap
  (`CATALOG_AUTOLOAD`, default on outside tests) and replaces all rows in one transaction under a Postgres advisory
  lock when the file's version or count differs from `CatalogDataset`; `parseCatalogFile` drops malformed foods.
- Search (`catalog-search.ts`, `CatalogService`): the query is normalized with `normalizeCatalogText` (shared, same as
  `searchName`), mapped through `CATALOG_SYNONYMS`, split into ≤ 8 tokens. Matching: every token is a substring
  (`LIKE ALL`); only when nothing matches that way, trigram `word_similarity` ≥ 0.45 (0.7 for queries of ≤ 4
  characters). Ranking: all tokens are whole words first, then the fewest extra words not in `CATALOG_PLAIN_WORDS`
  (raw, cooked, NFS, plain, whole…), then exact name > name starts with the query words > prefix > words > substring,
  then similarity, FNDDS > Foundation > SR Legacy, shorter name, id. `pg_trgm` is created by the migration and the
  `searchName` column has a GIN trigram index. Without `q` the endpoint lists the group A–Z.
- Logging: the web builds the item (`catalogEntryItem`: name shortened at a comma to `nameMax`, grams, nutrients and
  micros from per-100 g, `confidence: 'high'`, a counted portion when the USDA label is "N unit") and saves it with
  `POST /api/entries`, `source: 'database'`. Nothing about the catalog is stored on the entry, so later dataset
  updates never change logged values.
- Web: Log search shows up to 6 database matches under the user's own results (rows already in the library are
  hidden) with "See all" to `/foods`; `CatalogFoodSheet` picks a portion (USDA measures, ½–3× chips, or grams),
  shows live values, a nutrition table with per-100 g values, micros and the USDA link, then logs or hands a draft
  to the entry form. `/foods` (Food database page) searches, filters by `CATALOG_GROUPS` chips and pages by 30; the
  query and group live in the URL. The items editor's "From database" (`CatalogPickerSheet`) adds an ingredient
  with its exact per-100 g basis and replaces a blank starter item.

### Body metrics, weight log and onboarding

Profile adds `bodyFatPct` (3–70 %, null), `tdeeOverride` ("daily calorie burn", 800–8000 kcal, null = formula) and
`onboarded` (read: `onboardedAt != null`; write: `true` sets `onboardedAt` if unset, `false`/absent leaves it).
The three new `ProfileDto` fields are optional in PUT bodies — absent means unchanged. `computeTargets` uses
Katch-McArdle when body fat is known (else Mifflin-St Jeor) and `tdeeOverride` instead of BMR × activity when set.
`ProfileResponse.body = computeBodyMetrics(profile)` (BMI + category; lean/fat mass, FFMI, normalized FFMI +
category when body fat is known). Body bounds: `BODY_BOUNDS` in `@food/shared` (API and web must both use them).

Weigh-ins (`WeightLog`, one per user and local date). PUT upserts; if the date is ≥ the latest logged date the
profile's `weightKg` (and `bodyFatPct` when provided) is updated to match, so targets follow the current weight.
DELETE of the latest weigh-in sets the profile weight (and body fat) to the new latest one (unchanged if none remain).
Leaving `bodyFatPct` out of a PUT keeps the stored value, `null` clears it; profile body fat syncs only when a number
is sent. Dates after UTC today + 1 are rejected. Every web weigh-in mutation notifies both `weights` and `profile`.
`GET /api/weights?from&to` (span ≤ 400 days): `logs` in range (date asc); `trend` = `weightTrendSeries` over the
range warmed up with up to 60 days of earlier logs; `latest` = most recent weigh-in overall (≤ `to`);
`weeklyChangeKg` = `weeklyWeightChange(all logs ≤ to, to)`; `adaptiveTdee` = `adaptiveTdee()` over the 28 days
ending the day before `to` using daily entry calorie totals (logged = has ≥1 entry) and the weigh-ins in that
window (null when there is not enough data). Onboarding is a web flow shown once after login while
`profile.onboarded` is false; finishing or skipping sends `onboarded: true`.

### Accounts, sessions and admin

- Roles `admin` | `member`; status `active` | `disabled`. The first account (created via `/api/auth/setup` with the setup
  code) is admin; emails listed in `ADMIN_EMAILS` (comma-separated, case-insensitive) are promoted to admin whenever
  they sign in, are created, or their live session is re-checked, and cannot be demoted. Set `APP_URL` in production
  so invite/reset links never depend on proxy headers. There must always be at least one active admin.
- Sessions never expire in practice: the `ft_session` cookie (httpOnly, SameSite=Strict, path `/api`, Secure in
  production) holds a JWT `{ sub, sid }` without `exp`; the cookie `maxAge` is `API_LIMITS.sessionMaxAgeDays` and the
  server re-issues it (sliding) when the token is older than 24 h, updating `Session.lastSeenAt` and `User.lastSeenAt`
  (at most once per hour). Every request verifies the signature, that the `Session` exists and is not revoked and
  that the user is active (cache ≤ 30 s). Logout revokes the current session; password change/reset revokes all other
  sessions; disabling a user revokes all of theirs. Tokens without `sid` are rejected.
- Access requests (public, no email needed): `POST /api/access-requests` stores the request with a hashed random
  `statusToken` returned only to the requester (the web app keeps it in localStorage). The admin approves/rejects in
  the admin panel. `POST /api/access-requests/status` lets the requester check; when approved and no account exists,
  `POST /api/access-requests/accept { statusToken, password }` creates the member account and signs them in.
  Approval also creates an invite link the admin can share manually (WhatsApp etc.).
- Auth tokens (invite / reset) are random 32-byte base64url strings; only a SHA-256 hash is stored. Invites expire
  after `inviteTtlDays`, resets after `resetTtlDays`; single use; can be revoked/regenerated. Links are
  `{APP_URL or request origin}/invite/{token}` and `/reset/{token}`.
- Per-user AI budgets: effective monthly budget = `User.aiBudgetUnlimited` ? unlimited : `User.aiMonthlyBudgetUsd` ??
  (admin ? unlimited : `AI_MEMBER_MONTHLY_BUDGET_USD`). `AI_MEMBER_MONTHLY_BUDGET_USD` absent → 5; set to empty or
  `unlimited` → no member limit. `AiConfigDto.monthlyBudgetUsd` and `UsageSummaryResponse.budgetUsd` report the
  caller's effective budget. The admin panel offers default / custom amount / unlimited (no sentinel numbers). Analyze returns 429 "Your monthly AI budget is used up" when the user's
  month-to-date AI cost ≥ effective budget, and the global `AI_MONTHLY_BUDGET_USD` still caps the total. AI rate limits
  are keyed by user id (not IP).
- Privacy: admins see per-user aggregates only (entry count, AI requests/cost, last seen, sessions) — never another
  user's entries, photos, weights or profile.

### Barcodes and products

Products are per user (`Product`, unique per user + barcode, per-100 g/ml values, serving/pack size, source
`label` | `openfoodfacts` | `manual`). Lookup order: own product → Open Food Facts v2 product API
(`https://world.openfoodfacts.org/api/v2/product/{code}?fields=...`, custom User-Agent `FoodLog/1.0`, 4 s timeout,
only accepted when energy is present; nutrients OFF does not provide are stored as 0 and listed in
`ProductDto.missingNutrients` so the web app can warn and invite a correction) → the found OFF
product is saved to the user's products immediately (so corrections persist) → not found returns `product: null` and
the web app offers the label scan, then saves the label values against the barcode with `PUT
/api/products/barcode/:code`. Logging (`POST /api/products/:id/log`, entry `source: 'barcode'`, or `'copy'` for a
saved food without a barcode, `productId` set,
single item named "{brand} {name}") uses `grams`, or `servings` × `servingSizeG` (fallback 100 g); increments
`useCount`/`lastUsedAt`. `EntryDto.productId` links entries to their product. Barcodes are normalized identically on the
web and the API (digits only; 12-digit UPC-A → 13-digit EAN-13 with a leading 0; GS1 check digit verified). A label
scan that started from an unknown barcode saves the product (`PUT .../barcode/:code`, source `label`) and then logs the
entry through `POST /api/products/:id/log` so usage is tracked. The scanner also accepts gallery images (file input without `capture`) and QR codes:
GS1 Digital Link URLs (`…/01/{GTIN}…`), GS1 element strings (`(01){GTIN}` or `01{GTIN}…`) and bare 8/12/13/14-digit
codes resolve to the GTIN; any other QR content shows "No product code in this QR". The web scanner self-hosts the zxing wasm as a hashed
`media/zxing_reader-*.wasm` asset (never a CDN). Food-library product results use one serving (servingSizeG ?? 100 g)
for `items`/`grams`/`totals` and the brand as `detail`. Products appear in the food library as kind `product` (key `product:{id}`, precedence
favorite > product > meal > food) and `POST /api/foods/log` supports them.

### Portions (count-based amounts)

Owner report: re-logging "2 Black Angus burgers" as ×1.5 logged 3 burgers because only grams were known. Meals and
items therefore carry an optional count-based portion (`Portion` in `@food/shared`: count > 0, singular `unit`,
`unitPlural`, e.g. `{ count: 2, unit: 'burger', unitPlural: 'burgers' }`; helpers `formatPortion`, `formatCount`
(½ ¼ ¾ ⅓ ⅔), `scalePortion`, `portionFactor`, `isValidPortion`).
- AI: the analysis schema adds a meal-level portion (count + singular + plural unit, nullable when the meal is not a
  countable dish, e.g. a plate of mixed rice and stew) and per-item count/unit/unit_plural (nullable; e.g. 2 eggs,
  3 slices). Counts come from the description first (ground truth), otherwise from counting what is visible.
  `AnalysisResult.portion` and `AnalysisItem.count/unit/unitPlural` expose them; menu dishes carry a portion too.
- Stored on `Entry` (portionCount/Unit/UnitPlural), `EntryItem` (count/unit/unitPlural), `Favorite` and `Draft`;
  returned as `portion` on EntryDto/FavoriteDto/DraftDto/FoodSearchResult and on items. Create/update requests accept
  `portion` (validated; null clears).
- Scaling: whenever an entry is created by scaling another (log again with a factor, quick log servings/grams,
  favorite log servings, whole-meal portion chips) the portion count and every item count scale by the same factor
  (rounded to 0.01). `QuickLogRequest.portionCount` (only when the result has a portion) means "log this many units":
  factor = portionCount / result.portion.count. Editing grams of a single item keeps its count unless the user edits
  the count (which rescales grams from the per-unit weight grams/count).
- Web: portions are shown wherever an entry/result appears ("2 burgers · 780 g · 1,450 kcal"). The review screen has a
  portion row (count stepper + unit) that rescales all items; when a portion exists the whole-meal chips become
  count-based (½, 1, 1½, 2, 3 units) instead of ×-multipliers. The quick-log sheet leads with "Last time: 2 burgers"
  and a unit stepper; without a portion it spells multipliers out ("Same as last time (780 g)", "½ of last time
  (390 g)") and offers a one-time "This was N <units>" that saves the portion on the source entry (PUT) so future
  re-logs are unit-based.

### My foods (saved foods, one value per food)

Owner report: ketchup and mayo on two home-cooked burgers (same bottles, one day apart) were logged under different
names with different nutrition. Goal: the same real food always gets the same values, with almost no effort ("no one
will follow up"). The design is automatic first; the user only confirms.
- Model: a saved food is a `Product` row. `barcode` is nullable (barcode-less saved foods: home staples, label photos
  without a code, merged foods); `aliases` (other names the user logged it under, matched case-insensitively after
  normalization), optional `unitName`/`unitGrams` ("1 tbsp = 15 g"). `EntryItem.productId` links an item to the saved
  food whose values it uses (FK set null on delete); product logs link their single item. `MyFoodDto` =
  `ProductDto` + `itemCount` (linked items). `SavedFoodRef` is the compact form sent with analysis items.
- Name normalization (shared by matching, suggestions and merge; API-side helper): lowercase, strip accents and
  punctuation, collapse spaces, singularize simple plurals, synonyms (mayonnaise→mayo, catsup→ketchup,
  yoghurt→yogurt, …), drop filler words (of, with, the, a, some, fresh, homemade, regular, plain, original).
- AI linking (food photo, text and follow-up modes; never label/menu/barcode): the user message lists up to 40 saved
  foods (most used, then most recent) as `name (brand; also: aliases)`. The strict schema gets per-item
  `saved_food` (string|null): the exact listed name when the item IS that food, else null. Normalize resolves it by
  name or alias; unknown names are ignored. A resolved item takes the saved name, `productId`, and the saved per-100
  values (nutrients = per100 × grams / 100); when the item has a count whose unit equals `unitName` and `unitGrams` is
  set, grams = count × unitGrams. Deterministic fallback when the AI returned null: an exact normalized name/alias
  match links the same way. `AnalysisItem.savedFood` is set for linked items; `suggestedFood` is set for unlinked
  items whose normalized tokens contain all tokens of a saved food's name or alias (or vice versa) without conflicting
  qualifiers (see suggestions), for the web to offer one tap.
- Saving: `EntryItemInput.productId` is stored when it is one of the user's products (otherwise stored as null, never
  an error); creating an entry increments `useCount`/`lastUsedAt` of each distinct linked product. Every copy (log
  again, quick log, favorites, drafts, compare) keeps item links. Favorite `items` JSON carries `productId` too.
- Food library: saved foods without a barcode appear as kind `product` like barcode products
  (`FoodSearchResult.barcode` is null for them, so the web shows a link icon instead of a barcode); aliases are
  searchable. A `food` result whose items are all linked to one saved food folds into that product result (no
  duplicate rows); the product result then uses the latest linked item's grams as its default amount.
- Suggestions (`GET /api/my-foods/suggestions`, deterministic, no AI): items of the last 120 days (grams > 0) are
  grouped by normalized name. Two names join when one's token set contains the other's and the extra tokens are at
  most 2 and contain no conflicting qualifier (light, lite, low, reduced, zero, diet, free, skim/skimmed, whole, full,
  sugar, protein, vegan, state words dry/raw/uncooked/cooked/boiled/fried/dried/powder/juice, and any word naming a
  different base food such as chicken/beef/turkey/fish/pork/egg/cheese when the other side names another one); a
  group may not contain two names that are incomparable with each other (prefer the pairing with more logged items).
  Variants are distinct normalized names ("Cabbage, raw shredded" and "Cabbage, raw, shredded" are one variant; a
  saved food linked to the group is always a variant) with display name (most recent casing), times logged, typical
  grams (median), latest per-100 values and kcal range, `valueSource` (`saved` for a linked saved food, `label` when
  it came from a label or barcode entry, else `estimate`) and exactly one `recommended` (saved > label > most logged >
  most recent). The key is the shortest normalized name ("tomato ketchup"); the label is its display name. A group is
  suggested when it spans ≥ 2 entries, its max kcal/100 g is ≥ 5 (skips salt, water, zero-calorie drinks), and either
  it has ≥ 2 variants or its kcal/100 g spread is ≥ 10 % of the max and ≥ 5 kcal/100 g — unless all its items already
  link to one saved food, carry its name and match its values; keys in `Profile.dismissedFoodMerges` are skipped.
  Sorted by impact = kcal/100 g spread × typical grams / 100 × items (desc), then items (desc); at most 5. Reference
  (owner's real data): "Heinz tomato ketchup" (103–118) + "Tomato ketchup" (110) → one group;
  "Heinz mayonnaise, regular" + "Mayonnaise, regular" → one group without "Garlic mayonnaise sauce";
  "Sofisoft potato bun" + "Sofisoft potato bun, top hollowed" → one group; "Chicken breast, grilled" and
  "Chicken breast, cooked, skinless" are not grouped; salt is never suggested.
- Merge (`POST /api/my-foods/merge`, one transaction): with `productId` the saved food is updated (name, per100,
  aliases += names), otherwise a new saved food is created (`source: manual`, aliases = the other names); the result
  never duplicates an alias equal to the name. `applyToPast` (web default on): every own item whose normalized name
  matches any merged name or alias (any date) or that already links to the food is linked, renamed to the canonical
  name and recomputed from per100 × grams / 100 (counts and grams unchanged); each touched entry's totals are
  recomputed from its items; favorites whose items match are updated the same way. Returns the counts. Editing a
  saved food's values with `applyToPast` recomputes linked items/entries/favorites the same way. Deleting a saved
  food keeps past values (links go null).
- Web: review screen items show a small "My food" chip when linked (tap: unlink, pick another saved food) and, when
  `suggestedFood` is set, one line "Same as your Heinz ketchup? Use it" (applies the saved name/values/link; dismiss
  hides it for that item). The items editor offers "Save as my food" on any item (name, optional brand, values from
  the item, optional unit) and links it; manually typed items get the same one-tap suggestion from a cached saved-food
  list. Label results without a barcode offer "Save to My foods". Today shows at most one merge suggestion card per
  day ("Ketchup was logged 3 ways (103–118 kcal/100 g). Make it one food?" → Review / Not now (snoozed until tomorrow,
  per device) / Don't ask for ketchup (dismiss)). The merge sheet lists variants as checkboxes (all included by default; unchecking one
  leaves it out of `names`) with values, times logged and a source badge, a "Use these values" choice (recommended
  preselected), a name field (prefilled with the recommended variant's name) and "Also fix N past items" (on). Settings → My foods lists saved foods
  (search, badges Barcode/Label/Manual, aliases, times used), the pending suggestions at the top, and add/edit/delete
  (edit: name, brand, aliases, per-100 values, unit; "Update past logs" toggle when values change).
- Merge decisions (partial merges never nag): every merge appends `{ names, keptApart, productId, at }` to
  `Profile.foodMergeDecisions` (JSON array, newest last, at most 200 kept): `names` = normalized merged names + the
  saved food's name and aliases, `keptApart` = normalized names of the variants the user unticked
  (`MergeFoodsRequest.keptApart`, display names; the web sends every unticked variant), `at` = server time.
  Suggestions then (a) ignore items whose entry was created at or before a decision's `at` when the item's normalized
  name is in that decision's `names` or `keptApart` — the user already decided about them, whether or not past items
  were fixed; (b) never put a `keptApart` name in a group together with that decision's `names` or its saved food
  (treated as a conflict, at any time). Items logged after the decision still count, so a genuinely new duplicate
  (e.g. a fresh unlinked "Mayonnaise" with different values) can be suggested again.

### Day start (late-night eating)

Owner question: "If I eat at 1 am, should it count for the next day?" A meal at 1 am belongs to the day the user is
still awake in. `Profile.dayStartHour` (0–6, default 3; 0 = midnight) defines the logical day: a moment whose local
clock time is before `dayStartHour`:00 belongs to the previous calendar date. Shared helpers in `dates.ts`:
`DAY_START_HOURS` (0..6), `DEFAULT_DAY_START_HOUR` (3), `logicalDate(date: Date, dayStartHour: number): string`
(device-local), `logicalDateInTimeZone(date: Date, timeZone: string, dayStartHour: number): string`,
`isBeforeDayStart(time: string, dayStartHour: number): boolean` (time as HH:MM), and
`calendarDateFor(localDate: string, time: string, dayStartHour: number): string` (the real calendar date of a clock
time inside a logical day: the next day when the time is before the day start).
- Every `localDate` the web computes from a moment (now, photo time, chosen time, weigh-in, fluid log, draft, compare,
  favorites, quick log, Today/History/Stats "today") is the logical date. Entry times are still stored as the real
  instant (`timestamp`).
- Date + time pickers mean "eating day" + clock time: picking Oct 1 and 00:30 with a 3 am day start stores
  timestamp Oct 2 00:30 local and `localDate` Oct 1; the picker shows "after midnight" for such times.
- Today at 00:56 still shows the previous date as Today (with its totals); the header notes "Day ends at 3 am" only
  between midnight and the day start.
- Settings → "Day starts at" (Midnight, 1 am … 6 am) with "Food you log before 3 am counts toward the day before."
  Changing it affects new logs only; existing entries keep their dates (editable as before).
- The API never derives a user's day from server time for stored data; it trusts the client's `localDate` (validated
  format) and only uses `dayStartHour` for display defaults it returns.

### Fluids

Water and other drinks are tracked as millilitres per logical day; they never add calories by themselves.
- Sources: `FluidLog` rows (quick adds: `ml` 10–3000, `kind` water | coffee | tea | other, `timestamp`, `localDate`)
  plus drinks inside logged meals: `EntryItem.fluidMl` (ml of drinkable liquid in that item: water, coffee, tea, milk,
  juice, soda, shakes, beer/wine; null for foods including soups and yogurt). The AI returns per-item `fluid_ml`
  (strict schema, nullable, placed after the amount fields); product logs of a `basisUnit: 'ml'` product set
  `fluidMl` = the logged ml; every copy scales `fluidMl` with the same factor as grams (rounded to 1 ml); the items
  editor can set or clear it ("Counts as a drink: 330 ml").
- Target: `Profile.fluidTargetMl` (500–8000, null = auto). Shared `fluids.ts`: `FLUID_KINDS`, `FLUID_KIND_LABELS`,
  `FLUID_CAFFEINE_MG_PER_ML` (water 0, coffee 0.4, tea 0.2, other 0), `FLUID_LIMITS` ({ logMinMl: 10, logMaxMl: 3000,
  targetMinMl: 500, targetMaxMl: 8000 }), `autoFluidTargetMl(weightKg: number | null, trainingDay: boolean): number`
  (35 ml/kg rounded to 50 ml, clamped 1500–4500, 2500 without a weight, +500 ml on training days) and
  `fluidTargetMl(profile: { weightKg: number | null; fluidTargetMl?: number | null }, trainingDay: boolean): number`
  (override wins, no training bonus on an override).
- `GET /api/fluids?date=` → `FluidDayResponse` (logs sorted by time, drinks from that day's entries with `fluidMl`,
  `totalMl = logsMl + foodMl`, `caffeineMg` from coffee/tea logs only). `DaySummary.fluidsMl`/`fluidTargetMl` and
  `RangeStats.avgFluidsMl` (over days with any fluid), `fluidDays`, `fluidHitDays` (≥ 100 % of target) feed Stats.
  JSON export includes `fluids: FluidLogDto[]`; CSV export unchanged. Insights: `fluids-low` when fluids are below
  70 % of target on ≥ 4 of the last 7 days that have at least one fluid log (days whose only fluid is a drink inside a
  meal are not judged, so people who never log water are not nagged); `caffeine-high` when day caffeine exceeds the
  age-based limit (400 mg, 100 mg under 18) on any of the last 7 days (warning when on at least half of them).
- Web: a Today "Fluids" card (progress "1.4 / 2.8 L", +250 ml, +500 ml, "Other…" sheet with amount chips 150 / 250 /
  330 / 500 / 750 ml + custom and kind chips Water / Coffee / Tea / Other, time = now by default), today's logs with
  undo/delete, drinks from meals listed read-only ("Diet Pepsi · 330 ml · Chicken burger meal"). Optimistic adds with
  rollback + toast on failure. Settings → "Daily fluids" (Auto from weight, or custom L). Stats week: fluids per day
  bars against the target.

### Vitamins & minerals (estimates)

A general picture, not precise numbers. Keys (`MICRO_KEYS` in `micros.ts`): vitaminA (µg RAE), vitaminC (mg),
vitaminD (µg), vitaminE (mg), vitaminK (µg), vitaminB6 (mg), vitaminB12 (µg), folate (µg DFE), calcium (mg), iron
(mg), magnesium (mg), potassium (mg), zinc (mg), cholesterol (mg), caffeine (mg). `Micros` is a partial record: a
missing key means unknown, never zero.
- Shared `micros.ts` (types are in place; implement): `MICRO_META` (label, shortLabel, unit, group, decimals, max per
  item for sanity), `microTargets(sex: Sex | null, age: number | null): MicroTargets` — RDA/AI for adults by sex and
  age band (14–18, 19–30, 31–50, 51–70, 71+; NIH ODS / National Academies values; sex null = the mean of both rounded;
  age null = 31–50), cholesterol as a 300 mg limit, caffeine as a 400 mg limit (100 mg under 18), `upperLimit` only
  where the UL applies to total intake from food + supplements (vitamin C, vitamin D, vitamin B6, calcium, iron, zinc),
  otherwise null — plus `sanitizeMicros(input: unknown): Micros | null` (drops unknown keys, non-finite, negatives and
  values above `max`; empty → null), `addMicros`, `sumMicros`, `scaleMicros(m, factor)`, `microsFromPer100(per100,
  grams)`, `microsPer100From(micros, grams): Micros | null` (null when grams ≤ 0), `roundMicros(m)` (per meta decimals)
  and `microPercent(amount, target): number`.
- AI (food photo, text, follow-ups, label): per item `micros_per_100g` (strict object, each key nullable, units in the
  key names, e.g. `vitamin_a_ug_rae`, `folate_ug_dfe`, `caffeine_mg`) from typical food-composition values for the food
  and its state; supplements use the label amount per unit (grams = unit weight). Normalize stores absolute item
  `micros` (per100 × grams / 100, sanitized, rounded) and `microsPer100g` on `AnalysisItem`. Label mode also returns
  `micros_per_100` for printed vitamins/minerals (absolute amounts preferred; % values converted with the label's own
  reference — US %DV or EU %NRV) → `LabelInfo.microsPer100` → `Product.microsPer100`. Open Food Facts nutriments
  (`vitamin-c_100g` etc., stored in g) map to `microsPer100` with unit conversion. Menu scans do not estimate micros.
- Storage and copies: `EntryItem.micros` (absolute, JSON), `Product.microsPer100`; favorites/drafts items JSON carry
  `micros` and `fluidMl`; every copy scales micros by the same factor as grams; saved foods with `microsPer100` set
  item micros from it whenever their values are applied (AI linking, "Use it", merge/applyToPast, product log);
  saved foods without micros keep the item's own micros. Editing an item's grams rescales its micros; editing its
  nutrients by hand leaves micros as they are.
- Summaries: `DaySummary.micros` = sum of item micros + caffeine from coffee/tea fluid logs; `microsCoverage` = items
  that day vs items with micros; `RangeStats.avgMicros` = mean over days where at least half of the items have micros
  (`microsDays`), `microsCoverage` summed over the range.
- Web: Today → under the nutrition/limits card a "Vitamins & minerals" row that expands (grouped Vitamins / Minerals
  / Other: amount, % of target bar, "limit" styling for cholesterol and caffeine, an amber note above `upperLimit`:
  "Above the usual upper limit (100 µg/day)"), a coverage line ("Estimated for 7 of 9 foods; older logs have no
  vitamin data") and one disclaimer line ("Rough estimates to spot gaps, not exact amounts"). Entry edit and the
  review screen show the meal's micros in a collapsed section. Stats week: "Vitamins & minerals — 7-day average"
  with the same rows. My foods edit sheet: optional micros per 100 g under "More nutrients".

### Drafts ("save for later")

A draft is an unfinished log: photos and/or a description saved before analysis (e.g. no time or no signal while
eating), or an analysed result the user has not confirmed yet. Drafts never count toward totals, dashboards, insights,
exports or the food library. `Draft` rows own their photos through `DraftPhoto` (role, position; counted as references
by photo cleanup — draft photos are never garbage-collected), `items` (normalized EntryItemInput[] or null),
`analysisId` (latest analysis of the draft) and the intended time/meal. `POST /api/analyze` accepts `draftId`: the
draft's photos (with roles) and description are used like a previous analysis' photos; the web then `PUT`s the new
`analysisId`/items onto the draft or logs it. `POST /api/drafts/:id/log` creates the entry exactly like
`POST /api/entries` (source from the draft mode, photo = primary draft photo, rawAiJson from the analysis) and deletes
the draft in one transaction. Max `API_LIMITS.draftsMax` drafts per user. The web app keeps drafts created while
offline in IndexedDB and uploads them automatically when back online.

### Compare ("what should I eat?")

`/compare` lets the user put 2–4 options side by side before eating. Options come from the food library/favorites
(searched with `scope=standalone`, so condiments and other parts of meals are never offered),
saved products or a barcode, a text description, a food or label photo (via `POST /api/analyze`, one AI call each),
or a menu scan (`POST /api/compare/menu`: one AI call returns up to `menuDishesMax` dishes with per-serving estimates;
the user picks which to compare). Ranking is deterministic, client-side and free: each option's nutrients against
today's remaining targets (calories and protein fit first, then fiber, saturated fat, sodium and sugar limits), with
plain-English reasons. Any option can be logged in one tap (analysed options through `POST /api/entries` with their
`analysisId`, library/product options through quick log / product log, menu dishes as a single-item entry).
Nothing is stored for a comparison.

### AI meal ideas ("what should I eat, from what I usually eat?")

Owner request: "Ask the AI, based on what I usually eat and how much of my macros is left, what I should eat."
Compare ranks options the user brings; meal ideas proposes them. One text-only AI call, nothing stored.
- `POST /api/meal-ideas` with `MealIdeasRequest`: `localDate` (the logical eating day), `localTime`
  (`YYYY-MM-DDTHH:mm` device clock, as for analyze), optional `note` (≤ `API_LIMITS.mealIdeaNoteMax`: "eating out",
  "something sweet", "I have eggs") and `exclude` (≤ `mealIdeaExcludeMax` titles already shown, for "Ask again").
- Context sent to the model (`meal-ideas/meal-ideas-prompt.ts`): local time with its meal slot, goal, training or rest
  day, location, the day's targets, what was eaten, what is left (calories, protein and fiber still to reach, room
  under the saturated fat / sugar / sodium limits; "over by N" instead of negative numbers), the meals logged that
  day, and the usual foods: the first `IDEA_FOODS_MAX` (40) results of the food library's default ranking with
  `scope=standalone` (favorites, frequent and recent meals, saved foods; never ketchup-style parts of meals), each as
  `F1 | "name" (contains: first items of a multi-item meal) | usual amount | kcal | protein | carbs | fat | fiber |
  times logged | usual meal`.
- The model returns `mealIdeasMax` (3) options, best first, each one eating occasion: `title`, `meal_type`, `reason`
  (no numbers) and 1–`mealIdeaPartsMax` parts. A part is either a listed food (`food_id` + `servings` as a multiple of
  the usual amount, `estimate: null`) or a new food (`food_id: null` + `estimate`: grams, optional counted portion and
  the nutrients of that amount). Instructions: usual foods first (at least two options mostly from them, one may be a
  new idea), calories never above what is left and only a share of it when more meals are still to come, then protein,
  fiber and the limits; the user's note is ground truth; never refuse.
- Accuracy rule: the model never supplies numbers for the user's own foods. `normalizeMealIdeas` takes a listed
  food's items from the library result and scales them by `servings` (clamped to the quick-log range, counts, micros
  and fluids scaled too; back to 1 serving if the scaled items would break item limits), so totals are the user's
  saved values. A part without an id is linked by exact folded name unless it brings its own estimate. New foods go
  through `estimateServing` (the menu-scan consistency checks) and become one item with `confidence: 'medium'`.
  Unknown ids, empty estimates, duplicate titles and ideas left without parts are dropped; an idea never holds more
  items than one entry can (`API_LIMITS.itemsMax`).
- `MealIdeasResponse`: `summary`, `ideas` (`title`, `mealType`, `reason`, `parts` with `name`, `foodKey` | null,
  `servings` | null, `grams`, `portion`, `nutrients`, loggable `items`, plus `totals` and `grams`) and `usage`.
- Usage and limits exactly like menu scans: 503 unconfigured, 429 for the global or the user's monthly budget,
  `AiThrottlerGuard` (shared with analyze), one app-level retry, every attempt an `AiUsage` row with `mode: 'ideas'`
  (an `AnalysisMode` value used only for usage). The mock provider builds ideas from the listed foods plus fixed new
  ideas and honours `exclude`.
- Web: Today (today only) has an "AI meal ideas" row right under Quick add, next to the Compare link, and the "+"
  sheet has the same entry (`/today?ideas=1` opens the sheet and clears the parameter). The sheet asks as soon as it
  opens, shows what is left, the model's summary and one card per idea (meal type, kcal, macros, each food with its
  amount and a "New" chip for foods that are not the user's, the reason, and what the idea leaves or by how much it
  goes over), an "Anything specific?" field with the voice button, and "Ask again" (sends the note and excludes
  everything already shown). Ideas are kept for 30 minutes while the day is unchanged, so reopening costs nothing.
  "Log this": one usual food → `POST /api/foods/log` with its `foodKey` and `servings` (falling back to an entry if
  the food has left the library); anything else → `POST /api/entries` with every item, named after the idea,
  `source: 'copy'` when all parts are the user's foods, else `'text'`; the sheet closes and Today offers Undo.

### AI analysis

- `POST /api/analyze` (multipart). `mode`: `food_photo` and `nutrition_label` need an image unless
  `previousAnalysisId` is given (the previous analysis' photo is reused); `text` needs a non-empty description.
- Provider selection, resolved per request from `AiProviderSettingsService.snapshot()` (see AI provider setup):
  `DEMO_MODE` → mock; `AI_PROVIDER=mock` → mock (deterministic fake results, zero cost, used for development/tests);
  `OPENAI_API_KEY` set → the environment's OpenAI-compatible settings; else the provider saved in Settings → AI; else
  unconfigured → 503 `AI is not configured — an admin can add a provider in Settings → AI`, and the profile's
  `ai.provider` is `unconfigured` (see AI is optional).
- Model: `precise=true` → `OPENAI_PRECISE_MODEL` (default `gpt-6-astra`); otherwise profile `aiModel` if set and
  known, else `OPENAI_MODEL` (default `gpt-5.6-sol`). Reasoning effort `OPENAI_REASONING_EFFORT` (default `low`).
  `detail`: request field, else profile `aiDetailFood` / `aiDetailLabel` (default `high`).
- OpenAI: Responses API, strict JSON-schema Structured Outputs (zod schema + `zodTextFormat`), `store: false`,
  `maxRetries: 0` on the client, **exactly one app-level retry** for retryable failures, 90 s timeout,
  explicit prompt caching (`prompt_cache_options: { mode: 'explicit' }` + breakpoint on the static instructions) for
  `gpt-5.6*` / `gpt-6*` models only. No `temperature`.
- The model returns per-item **grams + per-100 g nutrients**; the server computes item nutrients
  (`nutrientsFromPer100g` → `roundNutrients`), runs consistency checks (Atwater ±15 %/15 kcal, fiber/sugar > carbs,
  sat fat > fat, kJ-as-kcal auto-fix, impossible densities) producing `flags` and `warnings`, and sums totals.
- Claude (`ai/providers/anthropic-structured.ts`, `@anthropic-ai/sdk`): Messages API with the instructions as `system`,
  images as base64 blocks before the text, and the same JSON schema as `output_config.format` (keywords Claude does
  not support, such as `$schema`, `minimum` or `maxLength`, are dropped; the zod parse still checks everything).
  Forced `tool_choice` is not used because Claude Sonnet 5.5 and Opus 5.5 reject it. `OPENAI_REASONING_EFFORT` maps to
  `output_config.effort` for catalog Claude models only (`none`/`minimal` → `low`). Stop reasons `refusal` and
  `max_tokens` map to the `refusal` and `incomplete` failure kinds; usage maps cache reads/writes and thinking tokens
  onto `AiTokenUsage`. `maxRetries: 0` and the same single app-level retry.
- Every attempt (success or failure, any provider) writes an `AiUsage` row with tokens, reasoning tokens, cost (hardcoded
  price map; unknown model → 0 and a logged warning), duration, error kind. Each analysis is persisted as an
  `Analysis` row (normalized `result`, `rawResponse`, photo, model, detail, precise, follow-up links).
- Optional `AI_MONTHLY_BUDGET_USD`: when month-to-date cost ≥ budget → 429 `Monthly AI budget reached`.
- Rate limit on analyze: `AI_RATE_LIMIT_PER_MINUTE` (default 6) and `AI_RATE_LIMIT_PER_HOUR` (default 60).
- Multiple photos: multipart accepts the legacy single `image` and/or `images` (≤ `API_LIMITS.analyzeImagesMax` files)
  with `imageRoles` = comma list of `food` | `label` aligned to `images` (default: the analysis' first photo takes the
  mode's natural role — label for nutrition_label, else food — later ones label). Adding photos to a previous `text`
  analysis switches it to `nutrition_label` (only label photos) or `food_photo`, keeping the description and answers. With `previousAnalysisId`, all photos of the previous analysis (with roles) are carried over and new uploads
  appended; when more than 3 would result, keep the first food photo and the newest others. Each photo is stored as
  an `AnalysisPhoto` (role, position); `Analysis.photoId` stays the primary (first food photo, else first photo) and is
  what entries show. The user message lists "Image n: food|label"; the prompt treats label/packaging images as the
  exact per-100 g source for the matching item and the food image + description for the amount eaten.
  `AnalyzeResponse.photos` lists them. Photo reference counting and cleanup must include `AnalysisPhoto`.
- Follow-up: `previousAnalysisId` + `followUpAnswer` re-runs with the previous photo/description plus the previous
  estimate summary, the question and the answer; the new `Analysis` links back.
- Several meals in one description (owner request: "describe what I ate the whole day and it splits them"): a fresh
  `text` analysis sent with `split=true` (ignored with photos, `previousAnalysisId` or `draftId`) uses the
  `meal_split` schema — `{ meals: [...] }`, each element being the normal food analysis preceded by `description`
  (the user's words for that meal), `meal_type` (only when named or implied by a stated time, else null), `eaten_at`
  (HH:MM only when stated, else null) and `days_ago` (0 unless an earlier day is stated) — with the single-meal
  instructions plus a "SEVERAL MEALS" section (one element per eating occasion, never one per food). One AI call; each
  meal is normalized like any analysis and stored as its own `Analysis` row (mode `text`, its own description, the
  usage rows linked to the first), so corrections, follow-ups and entries work per meal. The response is the first
  meal's `AnalyzeResponse` with `timing: MealTiming` (`mealType`, `time`, `daysAgo` 0–7) and, when more than one meal
  has food, `moreMeals: AnalyzeResponse[]` (at most `API_LIMITS.splitMealsMax` in total; later meals report zero
  usage). A single meal keeps the whole description. Providers without `analyzeMeals` fall back to the single
  analysis. `API_LIMITS.descriptionMax` is 2000 so a dictated day fits.

### AI provider setup (in the app)

- One `AiProviderConfig` row (`id = 'default'`, enforced by a check constraint): `provider` (`AI_PROVIDER_KINDS`:
  `openai`, `anthropic`, `gemini`, `openrouter`, `local`, `custom`), `baseUrl`, `apiStyle`, `model`, `preciseModel`,
  `voiceEnabled`, `transcribeBaseUrl`, `transcribeModel`, the two keys sealed, their last 4 characters,
  `updatedById`, timestamps.
- Presets (`AI_PROVIDER_PRESETS` in `@food/shared`) give each provider its address, API style, key requirement,
  default models and model suggestions. OpenAI, Claude and Gemini addresses are fixed; OpenRouter, local and custom
  are editable; only custom chooses its API style. Gemini, OpenRouter and local use Chat Completions.
- Keys: `SecretsService.seal/open` (`secrets/secret-box.ts`) use AES-256-GCM with a 12-byte random IV, the purpose as
  additional data, and an HKDF-SHA256 key from `SECRETS_KEY` or, when that is empty, from a random `encryption_key`
  `AppSecret`. Sealed values are `v1:<env|db>:<iv>:<tag>:<ciphertext>`. A key that no longer decrypts (for example
  after `SECRETS_KEY` changed) counts as missing and `AiProviderResponse.keyUnreadable` is true. Keys are never
  returned, logged or exported; a test-connection failure message has the key and any "API key provided: …" echo
  replaced by `[hidden]`.
- Saving: a key left out of the request keeps the saved one for the same provider and is dropped when the provider
  changes; `null` removes it. A provider that needs a key, an address or models is refused with 400.
- Precedence: `DEMO_MODE` → `source: 'demo'`, `AI_PROVIDER=mock` or `OPENAI_API_KEY` → `source: 'env'`; both make the
  card read-only and PUT/DELETE/test answer 403 (demo) or 409 (env). Otherwise `source` is `app` or `none`.
- Runtime: `AiProviderSettingsService` loads and decrypts the row on start-up and after every save or removal and
  keeps the resolved `RuntimeAiSettings` in memory. `AiConfigService`, `RuntimeAiProvider` (behind `AI_PROVIDER`,
  `MENU_AI_PROVIDER`, `MEAL_IDEAS_AI_PROVIDER`) and `RuntimeVoiceProvider` (behind `VOICE_AI_PROVIDER`) read that
  snapshot on every call and rebuild their client only when it changes, so a save takes effect without a restart.
- Catalog: OpenAI and Claude list their priced catalog models (`MODEL_CATALOG` entries carry a `vendor`); the other
  providers list exactly their two configured models, like a custom endpoint.
- Voice: OpenAI and custom share the AI address and key unless a transcription address or key is given. Claude,
  Gemini, OpenRouter and local need a transcription address or key (a key alone means OpenAI's endpoint); otherwise
  voice is reported off.
- Web: Settings → AI shows the "AI provider" card (`sections/ai-provider-card.ts`) to admins only. After a save or
  removal it notifies the `profile` topic, the profile reloads and `AiAvailability` follows without a page reload.

### AI is optional, and other providers

- No key: `AiConfigDto.provider` is `unconfigured`. The web's `AiAvailability` (`core/ai-availability.service.ts`,
  from the profile's `ai`) turns AI off everywhere: the Log home leads with search, the food database, barcode and
  "Add manually"; the photo, label, voice, "my day", meal-idea, Compare AI options and the unknown-barcode "scan the
  label" path are hidden; the shell's camera button opens search instead; Settings points admins at the AI provider
  card. Tests
  use `core/testing/ai-off.ts`.
- `OPENAI_BASE_URL` points the OpenAI SDK at any OpenAI-compatible server (Ollama, LM Studio, OpenRouter, Gemini).
  `AI_API_STYLE` = `responses` (default) or `chat`: `chat` sends the same schema-constrained request through Chat
  Completions (`ai/providers/openai-chat.ts`: `response_format` JSON schema, images as data URLs, a JSON code fence
  stripped, usage normalized) for servers without the Responses API. With a custom endpoint the selectable models are
  exactly `OPENAI_MODEL` and `OPENAI_PRECISE_MODEL` (`AiConfigDto.customEndpoint`), any name is accepted, prices are
  unknown so usage costs 0 (one warning per model), and budgets do not limit them.
- Voice: `AiConfigDto.voice` is false when voice is turned off or no transcription service is available; the voice
  button is then hidden. `TRANSCRIBE_BASE_URL` / `TRANSCRIBE_API_KEY` send dictation to a separate OpenAI-compatible
  Whisper server (defaults: the AI endpoint and key).

### Voice dictation

Owner request: "click the voice button just like in Claude or ChatGPT and describe what I ate". The web records with
`getUserMedia` + `MediaRecorder` (`core/voice-recorder.service.ts`: Opus/WebM, else MP4 — what iOS Safari produces —
else the browser default; at most `API_LIMITS.voiceMaxSeconds`, then it stops by itself) and uploads the audio to
`POST /api/transcribe`, which returns the text. Nothing is stored: the audio is forwarded to OpenAI and dropped.
- API (`src/voice/`, own provider token `VOICE_AI_PROVIDER` with OpenAI, mock and unconfigured implementations):
  `OPENAI_TRANSCRIBE_MODEL` (default `gpt-transcribe`), no `language` so mixed English/Arabic works, `maxRetries: 0`
  plus the usual single app-level retry. Accuracy lever: the user's own vocabulary — up to 40 saved foods (brand and
  name, most used first) and the 20 most frequent meal names of the last 90 days — is sent as `keywords` for
  `gpt-transcribe` (with a one-sentence `prompt` from `voicePromptIntro`: food diary, may mix languages, numbers and
  units as digits; when the profile has a location, "from someone in <location>" with its local languages and
  dishes) and inside the `prompt` for other models; if OpenAI rejects the hints with a 400 the call is repeated
  once without the vocabulary. Accepts `audio/*` plus `video/mp4` / `video/webm` (some browsers label recordings that
  way); a missing or unsupported file is 400. Silence returns `{ text: '' }`.
- Usage and limits: 503 when AI is unconfigured and 429 when the global or the user's monthly AI budget is reached
  (same checks as analyze); every attempt is an `AiUsage` row with `mode: 'voice'` (`AnalysisMode` enum value used
  only for usage, never for an `Analysis`); cost from `TRANSCRIPTION_MODELS` in `ai/models.ts` (per minute of audio
  when the response reports a duration, else per token; an unknown shape is recorded as 0 with a warning; a timeout
  is billed as a full-length recording). `VoiceThrottlerGuard`: twice the AI limits per user, in its own bucket, so
  dictating never uses up the analyze allowance. `Permissions-Policy` allows `microphone=(self)`.
- Web: `app-voice-button` (`shared/ui/voice-button.ts`) — mic button, then a recording pill with timer, Cancel and
  Stop, then "Transcribing…"; the text is appended to the description (`appendTranscript`: a space, or a new line
  after a finished sentence, capped at `descriptionMax`) so the user can read and fix it before analysing. It sits
  under the description field of the Log compose screen (all modes) and of Compare's "Describe it"; the Log home has
  a "Speak" tile that opens the text compose screen and starts recording at once (`VoiceIntentService`). Analyze is
  disabled while recording or transcribing. Hidden entirely where recording is unsupported. Errors are inline:
  blocked microphone, no microphone, offline, nothing heard, budget/rate limit, AI not set up. A recording whose
  upload failed (offline, 5xx, 429) is kept in memory and can be sent again with one tap instead of dictating again.
  The mock provider returns a fixed two-meal sentence, so dictation followed by Analyze exercises the meal split.

### Notes (notes to self, a second installable app)

Owner request: replace the WhatsApp "message yourself" chat used for notes ("Buy mirror", a photo with "Width around
20cm height around 30 cm", shared links and locations) with something that also takes voice, without building and
hosting a second project. Notes live in this codebase (same login, photo storage and transcription) but are a
separate app to the user: their own install, name and icon at `/notes`, with none of FoodLog's navigation.
- Model: `Note` (text, `done`, `doneAt`, timestamps; per user) and `NotePhoto` (note, photo, position). Note photos
  go through `PhotosService` like every upload (re-encoded, thumbnail, metadata stripped, `food` encoding) and a
  `NotePhoto` row counts as a photo reference for cleanup and `deleteIfUnreferenced`. Deleting a user removes them.
- API: `GET /api/notes` newest first (createdAt desc, id desc), `limit` default 50 and at most
  `API_LIMITS.notesPageMax`, `before` = the opaque `nextCursor` of the previous page (invalid → 400), `q` = every
  whitespace-separated token must be a case-insensitive substring of the text, `status` all | open | done.
  `POST /api/notes` takes multipart `text` + up to `API_LIMITS.notePhotosMax` `images`, or JSON `{ text }`; text is
  trimmed, at most `API_LIMITS.noteTextMax`; neither text nor photo → 400 "Write something or add a photo"; a fifth
  file → 400, an oversized one → 413. `PATCH` changes `text` (may be empty only when the note has photos) and/or
  `done` (`true` stamps `doneAt` once, `false` clears it); an empty body is 400. `DELETE` removes the note and
  releases its photos. Every query is scoped to the user (404 otherwise). The JSON export includes `notes`.
- Web (`features/notes`, route `/notes` outside the `Shell`, `authGuard` only): a chat-style feed (oldest at the
  top, newest at the bottom, calendar-day labels, older pages loaded on reaching the top) and a composer pinned to
  the bottom: auto-growing text box, camera and gallery buttons (photos compressed on the device, at most 4), the
  voice button (transcript appended), Send. Each note has a round "done" toggle (dimmed and struck through when
  done), opens its photos in the photo viewer, turns URLs into links, and has a "more" sheet (also on long-press):
  Edit text, Copy text, Delete (confirmed). Header: search and an All / To do / Done filter, plus an Install button
  when the browser offers one. Sending, ticking off and editing are optimistic with rollback; a note that could not
  be sent stays in the feed as "Not sent" with Retry and Discard (in memory only); the unsent composer text is kept
  in `localStorage` (`foodlog.notes.draft.{userId}`) so typed text survives a reload. Settings has a "Notes" row.
- Separate install: `public/notes.webmanifest` (`id`, `start_url` and `scope` `/notes`, name "Notes", amber note
  icons under `icons/notes/`) next to FoodLog's `manifest.webmanifest` (`id` `/`). The single `index.html` swaps the
  manifest link, title and icons with an inline head script when the path is `/notes`, and `AppIdentityService`
  keeps them in sync on router navigations; the title strategy shows just "Notes". Both manifests are served
  `no-cache`. One service worker (scope `/`) covers both apps.
- Notes on its own address (the way to have two apps on Android). Owner reports: Chrome refuses a second install at
  `/notes` while FoodLog (scope `/`) is installed ("This app is already installed"), also after installing Notes
  first; a Notes entry in FoodLog's `shortcuts` did open Notes, but inside FoodLog's single window, so the FoodLog
  icon then kept bringing Notes back. Android only gives each web app its own window per origin, so Notes is also
  served from a second hostname: `deploy/notes-proxy` (Caddy, `UPSTREAM` = the app service's private address) is a
  second Railway service with its own domain that forwards everything to the same backend, keeping the `Host`
  header and passing the visitor's IP on. Same accounts and data; the session cookie is per host, so people sign in
  once on each address.
  - A "Notes address" is any host whose first DNS label contains the word `notes` between hyphens
    (`foodlog-notes.example.com`, `notes.example.com`, `notes.localhost`; not `keynotes…`): `isNotesHost` in
    `core/app-identity.service.ts`, mirrored in the inline head script of `index.html`. No server setting, so the
    same static files (and service worker hashes) serve both addresses.
  - On a Notes address every page has the Notes identity (title, icons, `notes-app.webmanifest`: `scope` `/`,
    `start_url` `/notes`, share target), `notesHostGuard` sends the shell routes and onboarding to `/notes`, and the
    sign-in page shows the Notes icon and wording. FoodLog's address is unchanged; `/notes` there still works inside
    FoodLog.
  - The web manifests are not in the service worker cache and are served `no-cache`, so Chrome's update check for
    an installed app always sees the current manifest. FoodLog's manifest has no Notes shortcut.
- Sharing into Notes (Android): the manifest's `share_target` (GET `/notes?title=&text=&url=`) puts text, links and
  map locations shared from other apps into the composer; the params are then removed from the address. Photos
  cannot be shared in this way yet (that needs a POST share target handled by the service worker); they are attached
  inside the app.

- Off by default: Notes is the owner's personal addition, so the API answers 404 "Notes are not enabled on this
  server" (`NotesEnabledGuard`) unless `NOTES_ENABLED=true`; `AuthStatusResponse.notes` tells the web, whose
  `notesEnabledGuard` sends `/notes` to `/` and whose Settings hides the Notes row.

### Demo mode

`DEMO_MODE=true` runs a public demo (`src/demo/`). The sign-in page shows "Try the demo" when
`AuthStatusResponse.demo` is set (setup is never offered then).
- `POST /api/demo/start` (`@Public`, 10/hour per IP) needs the visitor's local date (±1 day of the server's UTC
  date) and UTC offset, and the food database (503 while it is still loading). It creates a member
  `demo-<uuid>@demo.invalid` with `demoExpiresAt` = now + `DEMO_TTL_HOURS`, a profile (`DEMO_PROFILE`), and with
  `createMany` the seed from `buildDemoSeed` (`demo-seed.ts`, seeded random per user): 60 days of meals built from
  catalog foods by name (`DEMO_FOOD_NAMES`, missing ones skipped), weigh-ins trending down, water, Monday, Wednesday
  and Friday training days and two favorites. Then it signs the visitor in like a normal login.
- `DemoCleanupService` (every 15 minutes) deletes expired demo users with their sessions and photos.
- Demo users cannot change their password (403); `AuthStatusResponse.demo.expiresAt` drives the shell's banner
  ("Demo sandbox · deleted in … · AI estimates are simulated").

### Import

Settings → Your data → Import (`features/settings/import/`). The file is parsed on the device:
`detectImport(name, text)` recognises a FoodLog JSON or CSV export, Cronometer "Food & Recipe Entries" (servings)
and biometrics exports, MyFitnessPal Nutrition and Measurement summaries, and any CSV with a date and a weight
column (kg or lb; the sheet asks when the unit is not in the file). The plan is sent in chunks (`import-runner.ts`:
100 meals, 500 weigh-ins, 1,000 drinks, 500 training days per request, within the `API_LIMITS.import*` maxima) to
`POST /api/import`, which in one transaction per chunk:
- creates meals with `source: 'import'`, skipping any whose `entryImportKey` (local date, timestamp, lower-case name,
  rounded calories) already exists, so importing a file twice changes nothing;
- creates weigh-ins only for dates without one, then copies the latest weigh-in to the profile;
- skips drinks with the same date, time and amount; sets training days, skipping existing ones.
The sheet shows the counts, the date range and rows left out, then a progress bar and a summary.

### Targets

`computeTargets(profile)` from `@food/shared` is the single source of truth (Mifflin-St Jeor, activity factor,
goal factor with safety caps, protein g/kg by goal, fat share, carbs remainder, sat-fat ≤ 10 % kcal,
fiber ≥ max(25, 14 g/1000 kcal), total sugar ≤ 90 g/2000 kcal, sodium ≤ 2300 mg, overrides). Training days:
`trainingDaysPerWeek = 0` → training day adds +10 % kcal as carbs; `1–6` → weekly calorie cycling (training days up,
rest days down, weekly total constant). A day's targets = `targetsForDay(result, dayMeta.trainingDay)`.
Kinds: calories/protein/carbs/fat are goals, `fiberMin` is a minimum, `satFatMax`/`sugarMax`/`sodiumMax` are limits.

### Insights (rule-based, no AI)

Computed over logged days (days with ≥1 entry) in the window. Stable ids. Examples: `satfat-over`
("Saturated fat over limit 5 of 7 days"), `sodium-over`, `fiber-low` (under 10 g most days), `fiber-good`,
`protein-hit` / `protein-low`, `protein-rest-days` (protein under target on rest days more than training days),
`calories-over` / `calories-under` / `calories-on-target` (avg vs target ±10 %), `sugar-over`,
`logging-gaps` (logged fewer than 70 % of days), `alcohol-days`, `weight-trend` (weekly change vs goal: e.g. losing
0.4 kg/week on a cut = good, gaining on a cut = warning), `adaptive-tdee` (measured burn differs from the formula /
override by > 10 % → info with the suggestion to use it).

### Export

`format=json`: `{ exportedAt, profile, entries: EntryDto[], favorites: FavoriteDto[], days: DayMetaDto[], weights: WeightLogDto[] }`.
`format=csv`: one row per item with columns
`date,time,meal_type,entry_name,item_name,grams,calories,protein_g,carbs_g,fat_g,sat_fat_g,fiber_g,sugar_g,sodium_mg,alcohol_g,confidence,source,description,entry_id`
(RFC 4180 quoting, UTF-8, `\r\n`). Filenames `foodlog-export-YYYY-MM-DD.json|csv`.

## Web (apps/web)

Angular 22.2: standalone components (no `standalone: true` flag needed), zoneless, **OnPush is the default**,
file names `thing.ts/.html/.css` (class names without `Component` suffix are fine, e.g. `TodayPage`), `inject()`,
signal `input()`/`output()`/`model()`, built-in control flow (`@if/@for/@switch`), `computed`, `linkedSignal`,
`resource`. Forms: Signal Forms (`@angular/forms/signals`: `form`, `FormField` → `[formField]`, `submit`) are stable —
prefer them; plain signals + `(input)` handlers are acceptable for small editors. HttpClient uses fetch by default;
do not add `withFetch()`. Typecheck: `npm run typecheck -w @food/web`; build: `npm run build -w @food/web`
(use `npx ng build --configuration development --output-path <unique tmp dir>` from `apps/web` when several
people build concurrently); tests: `npm test -w @food/web` (Vitest + jsdom; jsdom has no `matchMedia`).

Tailwind 4 via `@tailwindcss/postcss`; tokens in `src/styles.css` (`@theme`). Component CSS that uses `@apply`
must start with `@reference '../../styles.css';` (relative path). Keep component CSS tiny (4 kB budget) — prefer
utility classes in templates. Dark mode is the default (`data-theme="dark"` on `<html>`), light theme supported.

UI principles: dark-first, fast, one-thumb usable. Primary actions in the bottom half of the screen, touch targets
≥ 44 px, safe-area insets respected, the camera FAB is visible on every authenticated screen. Use skeletons/spinners
for loading, inline error states with retry, and optimistic UI where safe. Numbers: kcal integers, grams 0–1
decimals, sodium mg integer.

Charts: ngx-echarts 22 + echarts 6, **always lazy**: provide per component with `provideLazyEcharts()` from
`src/app/shared/charts/echarts.ts`; never import `echarts` eagerly. Chart host elements need an explicit height.

Describing several meals: the Log text flow always sends `split=true` (never for drafts or barcode descriptions).
One meal back → the usual review, placed by its `timing` when it has one (named meal → that meal type at its usual
time: breakfast 08:00, lunch 13:00, snack 16:00, dinner 20:00; stated time → that time; `daysAgo` → that eating
day; never in the future). Several meals back → a "N meals found" screen (`meals-panel`, phase `meals` in
`LogStore`, helpers in `meal-batch.ts`): one card per meal in eating order with meal type, an inline time input,
kcal/protein, the first items and a "Needs a look" / "1 question" chip; an "Eaten on" date moves all meals to
another day; a card opens the normal review for that meal ("Meal 2 of 3", back keeps the edits, "Save to log" saves
just that meal and returns to the rest, no draft action); "Save N meals" creates one entry per meal in order and
keeps the unsaved ones with an error if a request fails. Compare's "Describe it" never splits.

Service worker: production only. Non-GET `/api` requests carry `ngsw-bypass` (interceptor). `/api/**` is never
served by the SW navigation fallback.
