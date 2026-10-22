# Food database

FoodLog ships with a built-in database of **13,331 foods and dishes** with full nutrition per 100 g, vitamins and
minerals, and USDA household portions ("1 slice", "1 cup", "1 large"). It works without an AI key and without an
internet connection, so a meal can always be logged from real reference values.

## Source and license

All values come from [USDA FoodData Central](https://fdc.nal.usda.gov/):

| Dataset | Release | Foods kept | What it is |
|---|---|---|---|
| Foundation Foods | April 2026 | 311 | Analytical values for common ingredients |
| SR Legacy | April 2018 | 7,699 | The classic Standard Reference ingredient list, including restaurant and fast food |
| FNDDS 2021–2023 | October 2024 | 5,321 | Foods and dishes as people eat them (pizza, burritos, falafel, Greek yogurt with oats…) |

Duplicate names are kept once (Foundation first, then SR Legacy, then FNDDS) and foods without calories, protein,
carbs or fat are left out. 13,299 foods have vitamin and mineral values and 13,024 have household portions.

USDA FoodData Central data are in the public domain and published under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). USDA asks for this citation, which FoodLog
also shows in the app: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.
fdc.nal.usda.gov.

## What each food carries

- **Per 100 g:** calories, protein, carbs, fat, saturated fat, fiber, sugar, sodium and alcohol, the same nutrients
  as every FoodLog item. Calories use the dataset's own energy value, or its Atwater energy when the plain value is
  missing (Foundation Foods).
- **Missing values are shown, never guessed:** when the source does not report a nutrient (for example fiber for some
  SR Legacy foods), it is stored as 0 and listed, and the app says "No fiber data in the source".
- **Vitamins and minerals:** the 15 FoodLog micronutrients, where the source reports them (vitamin A as RAE, folate
  as DFE, vitamin D in µg).
- **Portions:** up to 8 USDA household measures with their gram weights. FNDDS's "Quantity not specified" becomes
  "1 serving", the amount a typical person eats.
- **A group:** one of 17 browsable groups (Dishes & sandwiches, Fast food, Meat, Poultry, Fish & seafood, Dairy & eggs,
  Vegetables, Fruits, Bread, grains & pasta, Beans, nuts & seeds, Snacks & sweets, Drinks, Fats & oils, Soups &
  sauces, Herbs & spices, Baby food, Other), mapped from the USDA food categories.

## Search

`GET /api/catalog/foods?q=` is built for typing on a phone:

- Every word must appear, in any order ("breast chicken roasted").
- Plain forms come first: "egg" finds "Egg, whole, raw" before "Egg burrito", "rice" finds "Rice, cooked, NFS"
  first. Words such as raw, cooked, NFS, plain and whole do not count against a food.
- Whole words beat parts of words ("pita" finds pita bread before spanakopita).
- Typos are forgiven when nothing matches the words exactly ("chiken brest", "bananna"), using PostgreSQL trigram
  similarity (`pg_trgm`), with a stricter threshold for short words so "milc" does not match everything.
- Common synonyms map to the USDA words: coke → cola, soda → soft drink, prawns → shrimp, aubergine → eggplant,
  courgette → zucchini, mince → ground, yoghurt → yogurt, and a few more.

Branded packaged foods are not in this database; scan their barcode instead (your own products first, then
Open Food Facts, then the label).

## Where it appears in the app

- **Log search:** matching database foods appear under "Food database", below your own foods. Tap one to pick a
  portion and log it.
- **Food database page** (`/foods`, linked from Log): search, filter by group, browse A–Z, open any food for its full
  nutrition table and vitamins, and log it.
- **Building a meal by hand:** in any meal editor, "From database" adds an ingredient with its exact values. Changing
  its grams later rescales from the USDA per-100 g values.

Logged database foods are saved like any other entry (source "Food database"), so they join your food library and
are one tap away next time.

## Loading and updating

The database file is `apps/api/catalog/usda-foods.json.gz` (about 0.9 MB). On start-up the API compares the file's
version with the one in the database and, when they differ, replaces the `CatalogFood` rows in one transaction
(a few seconds, guarded by an advisory lock so two instances never load at once). Nothing happens on later starts.

| Variable | Default | Purpose |
|---|---|---|
| `CATALOG_AUTOLOAD` | `true` (`false` in tests) | Load or update the database on start-up |
| `CATALOG_FILE` | the bundled file | Load a different build of the database |

To rebuild from newer USDA releases, download the three JSON datasets from
[FoodData Central downloads](https://fdc.nal.usda.gov/download-datasets), unzip them, then run:

```bash
npm run catalog:build -w @food/api -- --foundation <foundation.json> --sr <sr_legacy.json> --survey <surveyDownload.json>
```

Bump `version` in `apps/api/scripts/build-food-catalog.mjs` so running instances pick the new file up.
