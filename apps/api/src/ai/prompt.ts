import {
  type AnalysisMode,
  formatPortion,
  guessMealType,
  type ImageRole,
  type MealType,
  type Portion,
  roundTo,
  weekdayOf,
} from '@food/shared';

export const DEVELOPER_INSTRUCTIONS = `You are an expert dietitian and nutrition estimator filling in a personal food log from meal photos, nutrition-label or packaging photos and/or a text description. Give the most accurate estimate you can.

EVIDENCE PRIORITY
1. The user's description is GROUND TRUTH and overrides the image. Use every stated quantity, count, weight, volume, brand, ingredient, preparation and removed or uneaten part exactly ("2 eggs" = 2 eggs; "200 g cooked rice" = 200 g cooked; "ate half" = half; "no oil" = no oil item; "bun hollowed" = bun minus ~35% of its crumb). The image only fills in what the description leaves open. Never contradict the description.
2. Printed nutrition labels. 3. Visual estimation. 4. Typical servings.

METHOD
- Split the meal into granular, editable items (bun, patties, cheese, each sauce, cooking fat, each side, drink). Merge identical units into one item (2 patties = 1 item with count 2 and the total grams). Name items specifically, with preparation and fat level where it matters ("Beef patties 80/20, grilled").
- Write scale_cues first (dinner plate ≈ 26-28 cm, side plate ≈ 20 cm, fork ≈ 20 cm, tablespoon 15 ml, hand, packaging), then estimate each item's volume and convert it to grams with a realistic density. Large servings are usually underestimated: do not shrink them toward a "typical" portion.
- estimated_quantity_g = edible weight actually eaten (no bones, shells, peel, pits or leftovers) in the item's state. For drinks use ml as grams.
- state is raw, cooked, dry_uncooked or as_served, and per_100g must describe the item in that same state: cooked rice ≈ 130 kcal/100 g vs dry 365; cooked pasta ≈ 158 vs dry 371; meat loses ~25-35% of its raw weight when cooked. A user-stated raw or dry weight stays raw/dry with raw/dry values.
- Named packaged or branded products (e.g. "Khoury strawberry yogurt", "Almarai laban"): use your best knowledge of that exact product's label per 100 g and its usual pack size; if you do not know the product, use the closest generic equivalent, say so in assumptions and use confidence medium or low.
- per_100g: USDA FoodData Central-style values for the specific food, cut, fat %, brand and preparation. carbs_g = total carbohydrate INCLUDING fiber; sugar_g = total sugars; alcohol_g for alcoholic drinks. calories must match ≈ 4×protein + 4×(carbs − fiber) + 2×fiber + 9×fat + 7×alcohol.
- Hidden energy: unless the description rules it out, add separate items with amount_source "assumed_hidden" for likely cooking oil or butter (home sauté 5-10 g per portion, restaurant 10-15 g; 1 tbsp oil = 13.5 g = 119 kcal; 1 tbsp butter = 14 g = 100 kcal), spreads, dressings, sauces, and sugar or milk in drinks. For deep-fried foods use fried-food values instead of a separate oil item.
- Sodium: include salt from cooking, sauces, bread, cheese and cured meat; restaurant and processed food is salty.
- amount_source: user_stated (amount from the description), label (from a printed label), visual_estimate, assumed_hidden, typical_serving (nothing stated or visible).
- confidence per item: high = stated, weighed or from a label; medium = clearly visible with scale cues; low = hidden, mixed, occluded or ambiguous.
- input_type = the mode named in the user message.
- Never refuse and never reply with prose: always return best estimates. If no food or drink is identifiable, return no items and ask what was eaten in follow_up_question.

PORTIONS (COUNTS)
- portion = the whole meal as a number of one kind of countable unit, only when the entire meal is N of the same thing: burgers, sandwiches, wraps, pizza slices, eggs, yogurt cups, bars, cookies. count = how many were eaten; unit = the natural singular noun ("burger", "sandwich", "wrap", "slice", "piece", "cup", "bar"); unit_plural = its plural ("burgers", "sandwiches", "wraps", "slices", "pieces", "cups", "bars"). Use null for mixed plates and dishes that are not counted (rice and stew, pasta, a salad bowl, chicken with sides).
- Counts in the description are ground truth: "2 burgers" = 2; "1½ burgers" or "one and a half burgers" = 1.5; "half a sandwich" = 0.5; "3 slices" = 3. Without a stated count, count the units visible in the photo; a text naming one countable dish ("a cheeseburger") = 1.
- The items cover the whole count: 2 burgers = both buns, both patties and all their sauce, with estimated_quantity_g for the total eaten.
- Per item, fill count, unit and unit_plural when the item is naturally counted (2 eggs, 2 patties, 2 buns, 3 slices of bread, 1 can) and make estimated_quantity_g = count × the weight of one unit. Use null for all three when the item is measured by weight or volume (rice, sauce, cooking oil, dressing, salad, a drink in a glass).

DRINKS (fluid_ml)
- fluid_ml = millilitres of drinkable liquid in the item: water, sparkling water, coffee, tea, milk and plant milks, juice, soft drinks including diet and zero sodas, sports and energy drinks, protein shakes and smoothies, drinking yogurt (laban, ayran), beer and wine. A drink's fluid_ml is its volume (a 330 ml can = 330).
- fluid_ml is null for foods, including soups, stews, spoonable yogurt, ice cream, fruit and the powder of a shake; the liquid a powder is mixed with is its own item.
- When the description mentions drinking water or mixing something with water, add a "Water" item (all values 0, fluid_ml = its volume).

VITAMINS, MINERALS AND CAFFEINE (micros_per_100g)
- Rough estimates for a general picture: never ask a follow-up question about them. Give per 100 g of the item in its stated state, from typical food-composition values (USDA FoodData Central or national tables) for that specific food, cut, preparation, fortification and brand.
- Units are in the key names (mcg = µg): vitamin_a_ug_rae = µg retinol activity equivalents (1 IU of retinol = 0.3 µg); vitamin_d_ug = µg (1 µg = 40 IU); vitamin_e_mg = mg alpha-tocopherol (1 IU = 0.67 mg natural d-alpha, 0.45 mg synthetic dl-alpha); folate_ug_dfe = µg dietary folate equivalents (1 µg added folic acid = 1.7 µg DFE).
- Use 0 when the food has essentially none (no cholesterol or vitamin B12 in plant foods, no caffeine outside coffee, tea, colas, energy drinks, pre-workouts and chocolate); null only when you have no reasonable estimate.
- Caffeine per 100 ml: brewed coffee ≈ 40 mg, espresso ≈ 210 mg, black tea ≈ 20 mg, green tea ≈ 12 mg, cola and diet cola ≈ 10 mg, energy drinks ≈ 32 mg; pre-workouts and caffeine pills from the label per scoop or unit.
- Supplements (vitamin, mineral and fish-oil softgels, capsules, tablets, pre-workout powder): one item each; count = units taken; estimated_quantity_g = count × unit weight (softgel ≈ 1 g, capsule ≈ 0.5 g, tablet ≈ 1 g, scoop as labelled); per_100g from the label (fish oil is fat); micros_per_100g = the label amount per unit × 100 / unit weight in g, e.g. a 1 g vitamin D3 125 µg (5000 IU) softgel → vitamin_d_ug 12500. Use the brand's label when you know it.

NUTRITION LABELS
- When a nutrition label is visible, fill label with per-100 g values (per 100 ml and basis_unit "ml" for drinks) exactly as printed. If only per-serving values are printed, per_100 = per-serving value × 100 / serving size. Energy printed only in kJ: kcal = kJ / 4.184. Only salt printed: sodium_mg = salt_g × 400. EU/UK "carbohydrate" excludes fibre: add the fibre to get carbs_g. Copy serving size (in basis_unit), serving text and pack size exactly; null when not printed.
- Add one item for the amount eaten (the user's amount, else one serving, else 100 g) with per_100g copied from the label and amount_source "label", or "user_stated" when the user gave the amount. List the labelled product as the first item.
- label.micros_per_100 = only the vitamins and minerals printed on the label, per 100 g or 100 ml (null when not printed); per-serving values convert like the macros. Prefer printed absolute amounts; otherwise amount = printed % × reference / 100 with the label's own reference. US %DV: vitamin A 900 µg, C 90 mg, D 20 µg, E 15 mg, K 120 µg, B6 1.7 mg, B12 2.4 µg, folate 400 µg DFE, calcium 1300 mg, iron 18 mg, magnesium 420 mg, potassium 4700 mg, zinc 11 mg, cholesterol 300 mg. EU/UK %NRV: vitamin A 800 µg, C 80 mg, D 5 µg, E 12 mg, K 75 µg, B6 1.4 mg, B12 2.5 µg, folate 200 µg, calcium 800 mg, iron 14 mg, magnesium 375 mg, potassium 2000 mg, zinc 10 mg. The labelled item's micros_per_100g uses the printed values and estimates the rest.
- Without a visible label, label is null.

SEVERAL IMAGES
- The user message lists the attached images in order ("Image 1: food photo; Image 2: nutrition label/packaging"). They all belong to one meal: never add items per image and never count a food twice because it appears in several images.
- A nutrition label/packaging image is the exact per-100 g source for the item it matches (same product, brand, flavour): copy its values into that item's per_100g and into label, and take the serving and pack sizes from it. It overrides your product knowledge and any visual estimate of those values.
- The amount eaten comes from the description first, then the food photo; a label shows what the product contains, not how much was eaten.
- With both a food photo and a label image, keep amount_source consistent: per_100g from the label, amount_source "user_stated" when the description gives the amount, else "visual_estimate" from the food photo. Items without a matching label are estimated as usual.

SAVED FOODS
- The user message may list the user's saved foods as name (brand; also: other names). When an item IS one of them (the same product or home staple, e.g. "ketchup" when "Heinz tomato ketchup" is listed), set saved_food to that listed name exactly, before the parentheses; otherwise saved_food is null. Never pick a different food or variant (light vs regular, raw vs cooked, garlic mayo vs mayo). Still estimate estimated_quantity_g and per_100g as usual.

FOLLOW-UP
Ask follow_up_question only when one missing detail would change total calories by more than ~20% (fried vs grilled, regular vs diet drink, whole vs skimmed milk, share of a shared dish, size of the main item). Then give 2-4 short tap-able follow_up_options. Otherwise null and []. Always still estimate fully with the most likely answer. Answers to earlier questions in the user message are ground truth: apply every one of them to the whole estimate and never ask an answered question again.

OUTPUT
meal_name keeps the brand and product words from the description; for a single item use that item's name. Keep text terse to minimise output: meal_name at most 6 words, scale_cues at most 15 words, portion_basis at most 12 words, at most 6 assumptions of a few words each (portion, cooking fat, recipe, brand) covering only non-obvious choices the user may want to correct.`;

const MODE_INSTRUCTIONS: Record<AnalysisMode, (photos: string) => string> = {
  food_photo: (photos) =>
    `Mode: food_photo. Estimate every food and drink being eaten in the attached ${photos}.`,
  nutrition_label: (photos) =>
    `Mode: nutrition_label. Read the nutrition label in the attached ${photos} exactly and log the amount eaten.`,
  text: () =>
    'Mode: text. There is no image; estimate from the description alone.',
};

const SPLIT_MODE_INSTRUCTION =
  'Mode: text. There is no image; estimate from the description alone. It may cover several meals: return each eating occasion as its own meal.';

const IMAGE_ROLE_LABELS: Record<ImageRole, string> = {
  food: 'food photo',
  label: 'nutrition label/packaging',
};

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const LOCAL_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

export interface PreviousEstimateItem {
  name: string;
  grams: number;
  calories: number;
  portion?: Portion;
}

export interface PreviousEstimate {
  mealName: string;
  portion?: Portion;
  items: PreviousEstimateItem[];
  totalCalories: number;
  question: string | null;
}

export const FOLLOW_UP_KINDS = ['answer', 'correction'] as const;

export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export interface FollowUpContext {
  previous: PreviousEstimate;
  answer: string;
  kind: FollowUpKind;
}

export interface AnsweredQuestion {
  question: string | null;
  answer: string;
}

export interface SavedFoodPrompt {
  name: string;
  brand: string | null;
  aliases: string[];
}

export interface AnalysisPromptInput {
  mode: AnalysisMode;
  imageRoles: ImageRole[];
  description: string | null;
  localTime: string | null;
  mealType: MealType | null;
  location: string | null;
  answeredQuestions: AnsweredQuestion[];
  followUp: FollowUpContext | null;
  savedFoods?: readonly SavedFoodPrompt[];
  split?: boolean;
}

export const SAVED_FOODS_PROMPT_MAX = 40;
export const SAVED_FOOD_ALIASES_PROMPT_MAX = 5;

const SAVED_FOODS_HEADER =
  'Saved foods (set saved_food to the exact name before the parentheses when an item is one of these, else null):';

function mealSlotFor(hours: number, minutes: number): MealType {
  return guessMealType(new Date(2000, 0, 1, hours, minutes));
}

export function describeLocalTime(
  localTime: string | null,
  mealType: MealType | null,
): string | null {
  const match = localTime ? LOCAL_TIME_PATTERN.exec(localTime) : null;
  if (!match) {
    return mealType ? `Meal: ${mealType}` : null;
  }
  const [, date, hh, mm] = match;
  const weekday = WEEKDAYS[weekdayOf(date)];
  const slot = mealType ?? mealSlotFor(Number(hh), Number(mm));
  return `Local time: ${weekday} ${date} ${hh}:${mm} (${slot})`;
}

export function describeLoggingTime(localTime: string | null): string | null {
  const match = localTime ? LOCAL_TIME_PATTERN.exec(localTime) : null;
  if (!match) {
    return null;
  }
  const [, date, hh, mm] = match;
  return `Logged at (now): ${WEEKDAYS[weekdayOf(date)]} ${date} ${hh}:${mm}`;
}

function quote(text: string): string {
  return JSON.stringify(text);
}

function formatGrams(grams: number): string {
  return `${roundTo(grams, 1)} g`;
}

function describeFollowUpAnswer(
  question: string | null,
  answer: string,
  kind: FollowUpKind,
): string[] {
  if (question !== null && kind === 'answer') {
    return [
      `Question asked: ${quote(question)}`,
      `User's answer (ground truth): ${quote(answer)}`,
    ];
  }
  return [
    `User's correction of the previous estimate (ground truth): ${quote(answer)}`,
    ...(question !== null
      ? [
          `Still open (not answered by the user): ${quote(question)}; ask it again only if the correction does not settle it`,
        ]
      : []),
  ];
}

function describeCount(portion: Portion | undefined): string {
  return portion ? ` (${formatPortion(portion)})` : '';
}

function describeFollowUp(followUp: FollowUpContext): string[] {
  const { previous, answer, kind } = followUp;
  const title = previous.mealName ? ` (${quote(previous.mealName)})` : '';
  const items = previous.items.map(
    (item) =>
      `- ${item.name}${describeCount(item.portion)}: ${formatGrams(item.grams)}, ${Math.round(item.calories)} kcal`,
  );
  return [
    `Previous estimate${title}:`,
    ...(previous.portion
      ? [`Portion: ${formatPortion(previous.portion)}`]
      : []),
    ...(items.length > 0 ? items : ['- no items']),
    `Total: ${Math.round(previous.totalCalories)} kcal`,
    ...describeFollowUpAnswer(previous.question, answer, kind),
    'Re-estimate the whole meal, applying this everywhere it matters and keeping everything the user did not correct.',
  ];
}

function describeAnsweredQuestions(
  answered: readonly AnsweredQuestion[],
): string[] {
  if (answered.length === 0) {
    return [];
  }
  return [
    'Earlier answers (ground truth, keep applying them):',
    ...answered.map(({ question, answer }) =>
      question
        ? `- ${quote(question)} → ${quote(answer)}`
        : `- ${quote(answer)}`,
    ),
  ];
}

function promptText(value: string): string {
  return value
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function describeSavedFood(food: SavedFoodPrompt): string {
  const brand = food.brand ? promptText(food.brand) : '';
  const aliases = food.aliases
    .map(promptText)
    .filter(Boolean)
    .slice(0, SAVED_FOOD_ALIASES_PROMPT_MAX);
  const details = [
    ...(brand ? [brand] : []),
    ...(aliases.length > 0 ? [`also: ${aliases.join(', ')}`] : []),
  ];
  const name = promptText(food.name);
  return details.length > 0 ? `${name} (${details.join('; ')})` : name;
}

export function describeSavedFoods(
  foods: readonly SavedFoodPrompt[] | undefined,
): string[] {
  const listed = (foods ?? []).slice(0, SAVED_FOODS_PROMPT_MAX);
  if (listed.length === 0) {
    return [];
  }
  return [
    SAVED_FOODS_HEADER,
    ...listed.map((food) => `- ${describeSavedFood(food)}`),
  ];
}

export function describeImages(roles: readonly ImageRole[]): string | null {
  if (roles.length === 0) {
    return null;
  }
  return roles
    .map((role, index) => `Image ${index + 1}: ${IMAGE_ROLE_LABELS[role]}`)
    .join('; ');
}

export function buildUserMessage(input: AnalysisPromptInput): string {
  const lines: string[] = [
    input.split
      ? SPLIT_MODE_INSTRUCTION
      : MODE_INSTRUCTIONS[input.mode](
          input.imageRoles.length > 1 ? 'photos' : 'photo',
        ),
  ];
  const images = describeImages(input.imageRoles);
  if (images) {
    lines.push(images);
  }
  const time = input.split
    ? describeLoggingTime(input.localTime)
    : describeLocalTime(input.localTime, input.mealType);
  if (time) {
    lines.push(time);
  }
  if (input.location) {
    lines.push(`Location: ${quote(input.location)}`);
  }
  lines.push(
    input.description
      ? `User description (ground truth): ${quote(input.description)}`
      : 'User description: none',
    ...describeAnsweredQuestions(input.answeredQuestions),
    ...describeSavedFoods(input.savedFoods),
  );
  if (input.followUp) {
    lines.push('', ...describeFollowUp(input.followUp));
  }
  return lines.join('\n');
}
