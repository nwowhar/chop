import { parseIngredientLine } from '../src/lib/parseIngredient.js';

const cases = [
  // [line, expected qty, expected unit, expected name]
  ['1 lb ground pork',                         450,  'g',    'ground pork'],
  ['2 lbs boneless skinless chicken thighs',   900,  'g',    'boneless skinless chicken thighs'],
  ['1/3 cup green onions, thinly sliced',      80,   'ml',   'green onions'],
  ['1 tbsp fresh ginger, grated',              15,   'ml',   'ginger'],
  ['4 garlic cloves, minced',                  4,    'each', 'garlic cloves'],
  ['1½ tsp sesame oil',                        7.5,  'ml',   'sesame oil'],
  ['18-20 dumpling wrappers',                  20,   'each', 'dumpling wrappers'],
  ['1/4 cup chicken broth',                    60,   'ml',   'chicken broth'],
  ['Avocado oil',                              null, null,   'avocado oil'],
  ['150ml double cream',                       150,  'ml',   'double cream'],
  ['1 can of chopped tomatoes',                400,  'g',    'chopped tomatoes'],
  ['10 chicken thighs chopped',                10,   'each', 'chicken thighs'],
  ['3/4 tbsp chilli powder',                   11.25,'ml',   'chilli powder'],
  ['Juice of 1 lemon',                         1,    'each', 'lemon'],
  ['Juice of ½ lemon',                         0.5,  'each', 'lemon'],
  ['⅓ cup Greek yogurt',                       80,   'ml',   'greek yogurt'],
  ['2 garlic heads',                           2,    'each', 'garlic heads'],
  ['¼ tsp cayenne',                            1.25, 'ml',   'cayenne'],
  ['½ cucumber, grated and squeezed dry',      0.5,  'each', 'cucumber'],
  ['1 cup cherry tomatoes',                    240,  'ml',   'cherry tomatoes'],
  ['1 small red onion',                        1,    'each', 'red onion'],
  ['2 tbsp mayo',                              30,   'ml',   'mayo'],
  ['1 1/2 cups plain flour',                   360,  'ml',   'flour'],
  ['500 g beef mince',                         500,  'g',    'beef mince'],
  ['2 x 400g tins chickpeas',                  2,    'each', 'x 400g tins chickpeas'],
  ['Salt and pepper to taste',                 null, null,   'salt and pepper'],
  ['8 oz cream cheese, softened',              224,  'g',    'cream cheese'],
  ['1.5 kg lamb shoulder',                     1500, 'g',    'lamb shoulder'],
  ['3 large eggs',                             3,    'each', 'eggs'],
  ['1 tablespoon olive oil',                   15,   'ml',   'olive oil'],
  ['about 2 cups water',                       480,  'ml',   'water'],
  ['2 tsp ground cumin',                       10,   'ml',   'ground cumin'],
];

let pass = 0, fail = 0;
for (const [line, q, u, n] of cases) {
  const r = parseIngredientLine(line);
  const gotQ = r?.qty ?? null, gotU = r?.unit ?? null, gotN = r?.name ?? null;
  const ok = near(gotQ, q) && gotU === u && gotN === n;
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL  ${line}\n      got  qty=${gotQ} unit=${gotU} name="${gotN}"\n      want qty=${q} unit=${u} name="${n}"`);
}
function near(a, b) {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) < 0.05;
}
console.log(`\n${pass}/${pass + fail} passed`);
