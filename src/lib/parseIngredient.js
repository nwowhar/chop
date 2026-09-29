// ============================================================
// Deterministic ingredient line parser.
//
// Schema.org recipeIngredient gives us clean lines like
// "2 tbsp extra virgin olive oil" — already structured enough
// that paying a model to read it is waste. This turns a line
// into {qty, unit, name} with no network call.
//
// Used for URL imports, and as a sanity check on vision output.
// Deliberately conservative: when a line is ambiguous it returns
// qty null rather than guessing, and the caller falls back.
// ============================================================

const VULGAR = {
  '½': 0.5, '⅓': 1/3, '⅔': 2/3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1/6, '⅚': 5/6, '⅛': 0.125, '⅜': 0.375,
  '⅝': 0.625, '⅞': 0.875,
};

// to ml, or grams where the unit is a weight
const UNITS = {
  // volume
  tsp: ['tsp', 'teaspoon', 'teaspoons', 't'],
  tbsp: ['tbsp', 'tablespoon', 'tablespoons', 'tbs', 'tbl', 'T'],
  cup: ['cup', 'cups', 'c'],
  ml: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters', 'mls'],
  l: ['l', 'litre', 'litres', 'liter', 'liters'],
  floz: ['fl oz', 'floz', 'fluid ounce', 'fluid ounces'],
  pint: ['pint', 'pints', 'pt'],
  quart: ['quart', 'quarts', 'qt'],
  // weight
  g: ['g', 'gram', 'grams', 'gm', 'gms'],
  kg: ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms'],
  oz: ['oz', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  // countable
  clove: ['clove', 'cloves'],
  can: ['can', 'cans', 'tin', 'tins'],
  pack: ['pack', 'packet', 'packets', 'punnet', 'bunch', 'bunches', 'head', 'heads'],
  slice: ['slice', 'slices'],
  piece: ['piece', 'pieces'],
};

// ml per unit, or g where noted
const TO_ML = {
  tsp: 5, tbsp: 15, cup: 240, ml: 1, l: 1000,
  floz: 30, pint: 568, quart: 946,
};
const TO_G = { g: 1, kg: 1000, oz: 28, lb: 450 };

// units that are really "one of a thing"
const COUNTABLE = new Set(['clove', 'can', 'pack', 'slice', 'piece']);

const UNIT_LOOKUP = (() => {
  const m = new Map();
  for (const [canon, forms] of Object.entries(UNITS)) {
    for (const f of forms) m.set(f.toLowerCase(), canon);
  }
  return m;
})();

// preparation words to strip off the ingredient name
const PREP = new RegExp(
  '\\b(finely|roughly|coarsely|thinly|freshly|lightly|well)?\\s*' +
  '(chopped|diced|minced|sliced|grated|crushed|shredded|julienned|' +
  'cubed|halved|quartered|trimmed|peeled|deseeded|seeded|drained|' +
  'rinsed|beaten|melted|softened|toasted|zested|juiced|' +
  'squeezed dry|room temperature|at room temperature|plus more|' +
  'to taste|to serve|for garnish|for garnishing|for serving|optional|' +
  'divided|packed|heaped|level)\\b', 'gi');

const SIZE = /\b(large|small|medium|extra large|jumbo|baby)\b/gi;

// same words as PREP, anchored to the end of the line
const TRAILING_PREP = new RegExp(PREP.source + '\\s*$', 'i');

export function parseIngredientLine(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let s = raw
    .replace(/\(.*?\)/g, ' ')          // parenthetical asides
    .replace(/[⁄]/g, '/')          // fraction slash
    .replace(/\s+/g, ' ')
    .trim();

  const optional = /\b(optional|to taste|to serve|for garnish)\b/i.test(raw);

  // ---- quantity -------------------------------------------------
  let qty = null;
  let rest = s;

  // "Juice of 1 lemon" / "zest of 2 limes"
  const juice = s.match(/^(?:the\s+)?(juice|zest)\s+of\s+(?:about\s+)?([\d½⅓⅔¼¾/.\s]+)?\s*(.+)$/i);
  if (juice) {
    const n = juice[2] ? numberFrom(juice[2]) : 1;
    return finish(raw, n ?? 1, 'each', juice[3], optional);
  }

  const m = s.match(
    /^(?:about\s+|approx\.?\s+|around\s+)?([\d]+\s*[–-]\s*[\d]+|[\d]+\s*[¼-¾⅐-⅞]|[¼-¾⅐-⅞]|[\d]+\s+[\d]+\/[\d]+|[\d]+\/[\d]+|[\d]*\.?[\d]+)\s*(.*)$/
  );

  if (m) {
    qty = numberFrom(m[1]);
    rest = m[2];
  }

  // ---- unit -----------------------------------------------------
  let unitToken = null;
  const um = rest.match(/^([a-zA-Z]+\.?\s?[a-zA-Z]*\.?)\b\s*(.*)$/);
  if (um) {
    const candidate = um[1].replace(/\./g, '').trim().toLowerCase();
    const twoWord = candidate;
    const oneWord = candidate.split(' ')[0];

    if (UNIT_LOOKUP.has(twoWord)) { unitToken = UNIT_LOOKUP.get(twoWord); rest = um[2]; }
    else if (UNIT_LOOKUP.has(oneWord)) {
      unitToken = UNIT_LOOKUP.get(oneWord);
      rest = rest.replace(new RegExp(`^${oneWord}\\.?\\s*`, 'i'), '');
    }
  }

  // "of" after a unit — "2 cups of flour"
  rest = rest.replace(/^of\s+/i, '');

  // Dual measurements: "800 g / 1.6 lb chicken thighs". Common on
  // sites that serve both metric and imperial. Drop the alternate.
  rest = rest.replace(
    /^[/|]\s*[\d.,]+\s*(?:g|kg|oz|lb|lbs|ml|l|cups?|tbsp|tsp)\b\.?\s*/i, '');

  if (qty == null) return finish(raw, null, null, rest, optional);

  // ---- normalise ------------------------------------------------
  if (unitToken == null) {
    // a bare number means a countable thing: "2 onions"
    return finish(raw, qty, 'each', rest, optional);
  }
  if (COUNTABLE.has(unitToken)) {
    if (unitToken === 'can') return finish(raw, qty * 400, 'g', rest, optional);
    return finish(raw, qty, 'each', rest, optional);
  }
  if (TO_ML[unitToken]) return finish(raw, round(qty * TO_ML[unitToken]), 'ml', rest, optional);
  if (TO_G[unitToken])  return finish(raw, round(qty * TO_G[unitToken]),  'g',  rest, optional);

  return finish(raw, qty, 'each', rest, optional);
}

function numberFrom(t) {
  if (!t) return null;
  const s = t.trim();

  // range — take the upper bound, as the parser prompt does
  const range = s.match(/^([\d.]+)\s*[–-]\s*([\d.]+)$/);
  if (range) return parseFloat(range[2]);

  // "1 ½"
  const mixedV = s.match(/^(\d+)\s*([¼-¾⅐-⅞])$/);
  if (mixedV) return parseInt(mixedV[1], 10) + (VULGAR[mixedV[2]] ?? 0);

  // "1 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / parseInt(mixed[3], 10);

  // "1/2"
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10);

  // bare vulgar
  if (VULGAR[s] != null) return VULGAR[s];

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function finish(raw, qty, unit, nameRaw, optional) {
  const name = cleanName(nameRaw);
  if (!name) return null;
  return {
    raw_text: raw.trim(),
    name,
    qty,
    unit,
    optional,
    is_topping: /\b(to serve|for garnish|for garnishing|to taste)\b/i.test(raw),
  };
}

function cleanName(s) {
  if (!s) return '';
  let out = s.split(/,| - | — |\bor\b/)[0];

  // Preparation words only count as preparation when they trail:
  // "chicken thighs chopped" loses it, "chopped tomatoes" keeps it,
  // because that is the name of the tin you buy.
  for (let i = 0; i < 4; i++) {
    const trimmed = out.replace(TRAILING_PREP, '').trim();
    if (trimmed === out.trim() || !trimmed) break;
    out = trimmed;
  }

  return out
    .replace(SIZE, ' ')
    .replace(/\b(fresh|dried|raw|whole|plain|good quality|free range|organic)\b/gi, ' ')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------
// Whole-recipe parse from schema.org JSON-LD. Returns the same
// shape parse-recipe produces, so everything downstream is
// unchanged — or null when the data is too thin to trust, in
// which case the caller pays for a model call after all.
// ------------------------------------------------------------

export function parseRecipeLd(ld) {
  if (!ld) return null;

  const lines = asArray(ld.recipeIngredient ?? ld.ingredients)
    .filter((x) => typeof x === 'string' && x.trim());
  if (lines.length < 3) return null;

  const ingredients = lines.map(parseIngredientLine).filter(Boolean);
  if (ingredients.length < Math.ceil(lines.length * 0.8)) return null;

  // a parse that found no quantities at all is not a parse
  const withQty = ingredients.filter((i) => i.qty != null).length;
  if (withQty < ingredients.length * 0.5) return null;

  const steps = flattenInstructions(ld.recipeInstructions)
    .map((text, i) => ({
      step_no: i + 1,
      text,
      timer_seconds: timerFrom(text),
    }));

  return {
    title: typeof ld.name === 'string' ? ld.name.trim() : null,
    title_inferred: false,
    servings: servingsFrom(ld.recipeYield),
    source_handle: null,
    sections: [{ name: 'Ingredients', ingredients }],
    steps,
    steps_truncated: steps.length === 0,
    macros_per_serve: macrosFrom(ld.nutrition),
    notes: null,
  };
}

function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function flattenInstructions(x) {
  const out = [];
  for (const node of asArray(x)) {
    if (typeof node === 'string') {
      out.push(stripTags(node));
    } else if (node && typeof node === 'object') {
      if (node['@type'] === 'HowToSection' && node.itemListElement) {
        out.push(...flattenInstructions(node.itemListElement));
      } else if (node.text) {
        out.push(stripTags(node.text));
      } else if (node.name) {
        out.push(stripTags(node.name));
      }
    }
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

function stripTags(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
    .replace(/\s+/g, ' ')
    .trim();
}

function servingsFrom(y) {
  if (y == null) return null;
  const s = Array.isArray(y) ? y[0] : y;
  const n = parseInt(String(s).match(/\d+/)?.[0] ?? '', 10);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

function timerFrom(text) {
  const m = String(text).match(/(\d+)\s*(?:to|-|–)?\s*(\d+)?\s*(minute|min|hour|hr)/i);
  if (!m) return null;
  const n = parseInt(m[2] ?? m[1], 10);
  return /hour|hr/i.test(m[3]) ? n * 3600 : n * 60;
}

function macrosFrom(n) {
  if (!n || typeof n !== 'object') return null;
  const num = (v) => {
    const x = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(x) ? Math.round(x) : null;
  };
  const out = {
    kcal: num(n.calories),
    protein_g: num(n.proteinContent),
    carb_g: num(n.carbohydrateContent),
    fat_g: num(n.fatContent),
    fibre_g: num(n.fiberContent),
  };
  return out.kcal || out.protein_g ? out : null;
}
