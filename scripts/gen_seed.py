#!/usr/bin/env python3
"""Emit 003_seed_ingredients.sql for Chop.

Columns per row:
  name, aliases, category, default_unit, g_per_ml, g_per_each, ml_per_each,
  is_staple, shelf_life_days, purchase_unit, pack_size, divisible,
  meat, fish, dairy, gluten
"""

N = None
COLS = 16

# ---------------------------------------------------------------- produce
PRODUCE = [
 ("brown onion", ["onion","yellow onion","brown onions","diced onion"], "produce","g",N,150,N,True,30,"g",1000,True,0,0,0,0),
 ("red onion", ["red onions","spanish onion"], "produce","g",N,140,N,False,30,"g",1000,True,0,0,0,0),
 ("spring onion", ["green onion","green onions","scallion","shallots (green)"], "produce","g",N,15,N,False,7,"each",1,False,0,0,0,0),
 ("garlic", ["garlic clove","garlic cloves","minced garlic","crushed garlic","garlic head","garlic heads"], "produce","each",N,3,5,True,60,"each",1,True,0,0,0,0),
 ("ginger", ["fresh ginger","grated ginger","ginger root"], "produce","g",N,30,45,True,21,"g",100,True,0,0,0,0),
 ("lemon", ["lemons","lemon juice","juice of a lemon"], "produce","each",N,100,45,True,21,"each",1,True,0,0,0,0),
 ("lime", ["limes","lime juice"], "produce","each",N,70,30,False,21,"each",1,True,0,0,0,0),
 ("carrot", ["carrots"], "produce","g",N,80,N,True,21,"g",1000,True,0,0,0,0),
 ("celery", ["celery stalk","celery stick"], "produce","g",N,50,N,False,14,"each",1,False,0,0,0,0),
 ("potato", ["potatoes","desiree potato","sebago"], "produce","g",N,170,N,True,30,"g",2000,True,0,0,0,0),
 ("sweet potato", ["kumara","sweet potatoes"], "produce","g",N,200,N,False,21,"g",1000,True,0,0,0,0),
 ("tomato", ["tomatoes","truss tomato"], "produce","g",N,120,N,False,10,"g",1000,True,0,0,0,0),
 ("cherry tomatoes", ["cherry tomato","grape tomatoes"], "produce","g",0.6,N,N,False,10,"g",250,False,0,0,0,0),
 ("cucumber", ["lebanese cucumber","continental cucumber"], "produce","g",N,200,N,False,10,"each",1,True,0,0,0,0),
 ("capsicum", ["bell pepper","red capsicum","green capsicum"], "produce","g",N,160,N,False,12,"each",1,True,0,0,0,0),
 ("red chilli", ["chilli","fresh chilli","birds eye chilli","long red chilli"], "produce","g",N,10,N,False,10,"g",100,True,0,0,0,0),
 ("broccoli", ["broccoli head","broccoli florets"], "produce","g",N,350,N,False,10,"g",500,True,0,0,0,0),
 ("cauliflower", ["cauliflower head"], "produce","g",N,900,N,False,12,"each",1,True,0,0,0,0),
 ("zucchini", ["courgette","zucchinis"], "produce","g",N,200,N,False,12,"g",500,True,0,0,0,0),
 ("eggplant", ["aubergine"], "produce","g",N,350,N,False,10,"each",1,True,0,0,0,0),
 ("mushrooms", ["button mushrooms","swiss brown mushrooms","cup mushrooms"], "produce","g",N,20,N,False,7,"g",500,True,0,0,0,0),
 ("baby spinach", ["spinach","spinach leaves"], "produce","g",0.15,N,N,False,6,"g",120,False,0,0,0,0),
 ("lettuce", ["cos lettuce","iceberg lettuce","mixed leaves"], "produce","g",N,400,N,False,7,"each",1,False,0,0,0,0),
 ("cabbage", ["green cabbage","wombok","chinese cabbage"], "produce","g",N,1000,N,False,21,"each",1,True,0,0,0,0),
 ("bok choy", ["pak choy","baby bok choy"], "produce","g",N,120,N,False,6,"each",1,False,0,0,0,0),
 ("coriander", ["fresh coriander","cilantro","coriander leaves"], "produce","g",0.08,N,N,False,6,"each",1,False,0,0,0,0),
 ("parsley", ["flat leaf parsley","italian parsley","continental parsley"], "produce","g",0.08,N,N,False,7,"each",1,False,0,0,0,0),
 ("basil", ["fresh basil","basil leaves"], "produce","g",0.06,N,N,False,5,"each",1,False,0,0,0,0),
 ("mint", ["fresh mint","mint leaves"], "produce","g",0.07,N,N,False,6,"each",1,False,0,0,0,0),
 ("dill", ["fresh dill","dill fronds"], "produce","g",0.07,N,N,False,6,"each",1,False,0,0,0,0),
 ("thyme", ["fresh thyme"], "produce","g",0.07,N,N,False,10,"each",1,False,0,0,0,0),
 ("rosemary", ["fresh rosemary"], "produce","g",0.08,N,N,False,14,"each",1,False,0,0,0,0),
 ("avocado", ["avocados","hass avocado"], "produce","g",N,200,N,False,6,"each",1,True,0,0,0,0),
 ("apple", ["apples","granny smith","pink lady"], "produce","g",N,180,N,False,21,"g",1000,True,0,0,0,0),
 ("banana", ["bananas"], "produce","g",N,120,N,False,7,"g",1000,True,0,0,0,0),
 ("orange", ["oranges","navel orange"], "produce","each",N,180,70,False,21,"each",1,True,0,0,0,0),
 ("pumpkin", ["butternut pumpkin","kent pumpkin"], "produce","g",N,1500,N,False,30,"g",1000,True,0,0,0,0),
 ("green beans", ["beans","french beans"], "produce","g",N,6,N,False,8,"g",250,True,0,0,0,0),
 ("snow peas", ["mangetout"], "produce","g",N,4,N,False,7,"g",200,True,0,0,0,0),
 ("corn", ["corn cob","sweet corn"], "produce","each",N,250,N,False,10,"each",1,False,0,0,0,0),
 ("leek", ["leeks"], "produce","g",N,250,N,False,14,"each",1,True,0,0,0,0),
 ("shallot", ["eschalot","french shallot"], "produce","g",N,30,N,False,30,"g",250,True,0,0,0,0),
 ("kale", ["curly kale","tuscan kale"], "produce","g",0.1,N,N,False,7,"each",1,False,0,0,0,0),
 ("asparagus", ["asparagus spears"], "produce","g",N,18,N,False,7,"g",250,False,0,0,0,0),
 ("beetroot", ["beets","fresh beetroot"], "produce","g",N,150,N,False,21,"g",500,True,0,0,0,0),
 ("radish", ["radishes"], "produce","g",N,20,N,False,10,"g",250,True,0,0,0,0),
 ("fennel", ["fennel bulb"], "produce","g",N,300,N,False,12,"each",1,True,0,0,0,0),
 ("lemongrass", ["lemon grass","lemongrass stalk"], "produce","each",N,20,N,False,14,"each",1,False,0,0,0,0),
 ("kaffir lime leaves", ["makrut lime leaves","lime leaves"], "produce","each",N,1,N,False,30,"g",10,False,0,0,0,0),
 ("bean sprouts", ["beansprouts","mung bean sprouts"], "produce","g",0.1,N,N,False,4,"g",250,False,0,0,0,0),
]

# ---------------------------------------------------------------- meat
MEAT = [
 ("chicken thighs", ["boneless skinless chicken thighs","chicken thigh fillets","thigh fillets"], "meat","g",N,120,N,False,3,"g",1000,True,1,0,0,0),
 ("chicken breast", ["chicken breasts","breast fillet","chicken breast fillet"], "meat","g",N,200,N,False,3,"g",1000,True,1,0,0,0),
 ("chicken drumsticks", ["drumsticks"], "meat","g",N,110,N,False,3,"g",1000,True,1,0,0,0),
 ("whole chicken", ["roast chicken","chicken"], "meat","g",N,1600,N,False,3,"each",1,False,1,0,0,0),
 ("chicken mince", ["ground chicken","minced chicken"], "meat","g",N,N,N,False,2,"g",500,True,1,0,0,0),
 ("pork mince", ["ground pork","minced pork"], "meat","g",N,N,N,False,2,"g",500,True,1,0,0,0),
 ("beef mince", ["ground beef","minced beef","hamburger mince"], "meat","g",N,N,N,True,2,"g",500,True,1,0,0,0),
 ("lamb mince", ["ground lamb","minced lamb"], "meat","g",N,N,N,False,2,"g",500,True,1,0,0,0),
 ("pork belly", ["belly pork"], "meat","g",N,N,N,False,3,"g",1000,True,1,0,0,0),
 ("pork shoulder", ["pork scotch","boston butt"], "meat","g",N,N,N,False,3,"g",1000,True,1,0,0,0),
 ("beef steak", ["porterhouse","scotch fillet","rump steak","sirloin"], "meat","g",N,250,N,False,4,"g",500,True,1,0,0,0),
 ("beef chuck", ["chuck steak","stewing beef","casserole steak"], "meat","g",N,N,N,False,4,"g",1000,True,1,0,0,0),
 ("lamb shoulder", ["lamb forequarter"], "meat","g",N,N,N,False,4,"g",1000,True,1,0,0,0),
 ("lamb chops", ["lamb cutlets","loin chops"], "meat","g",N,90,N,False,3,"g",500,True,1,0,0,0),
 ("bacon", ["bacon rashers","streaky bacon","short cut bacon"], "meat","g",N,25,N,False,10,"g",250,True,1,0,0,0),
 ("chorizo", ["chorizo sausage"], "meat","g",N,120,N,False,14,"each",1,True,1,0,0,0),
 ("sausages", ["snags","pork sausages","beef sausages"], "meat","g",N,90,N,False,4,"g",500,True,1,0,0,0),
 ("ham", ["sliced ham","leg ham"], "meat","g",N,N,N,False,7,"g",200,True,1,0,0,0),
 ("prosciutto", ["parma ham"], "meat","g",N,12,N,False,14,"g",100,True,1,0,0,0),
]

# ---------------------------------------------------------------- seafood
SEAFOOD = [
 ("salmon fillet", ["salmon","atlantic salmon"], "seafood","g",N,180,N,False,2,"g",300,True,0,1,0,0),
 ("barramundi", ["barra","barramundi fillet"], "seafood","g",N,180,N,False,2,"g",300,True,0,1,0,0),
 ("white fish fillet", ["snapper","flathead","basa","white fish"], "seafood","g",N,170,N,False,2,"g",400,True,0,1,0,0),
 ("prawns", ["shrimp","green prawns","raw prawns"], "seafood","g",N,15,N,False,2,"g",500,True,0,1,0,0),
 ("tinned tuna", ["canned tuna","tuna"], "seafood","g",N,N,N,True,730,"g",95,False,0,1,0,0),
 ("tinned salmon", ["canned salmon"], "seafood","g",N,N,N,False,730,"g",210,False,0,1,0,0),
 ("anchovies", ["anchovy fillets","tinned anchovies"], "seafood","g",N,4,N,False,365,"g",45,False,0,1,0,0),
 ("squid", ["calamari","calamari rings"], "seafood","g",N,N,N,False,2,"g",500,True,0,1,0,0),
 ("mussels", ["black mussels"], "seafood","g",N,20,N,False,2,"g",1000,True,0,1,0,0),
 ("fish sauce", ["nam pla","nuoc mam"], "seafood","ml",1.15,N,N,True,730,"ml",300,False,0,1,0,0),
]

# ---------------------------------------------------------------- dairy
DAIRY = [
 ("milk", ["full cream milk","whole milk","dairy milk"], "dairy","ml",1.03,N,N,True,10,"ml",2000,False,0,0,1,0),
 ("thickened cream", ["double cream","heavy whipping cream","heavy cream","pouring cream"], "dairy","ml",1.0,N,N,False,14,"ml",300,False,0,0,1,0),
 ("sour cream", ["light sour cream"], "dairy","g",1.0,N,N,False,21,"g",300,False,0,0,1,0),
 ("butter", ["salted butter","unsalted butter","melted butter"], "dairy","g",0.911,N,N,True,60,"g",250,False,0,0,1,0),
 ("greek yoghurt", ["greek yogurt","natural yoghurt","plain yoghurt","yogurt","yoghurt"], "dairy","g",1.03,N,N,True,21,"g",500,False,0,0,1,0),
 ("cheddar cheese", ["tasty cheese","cheddar","grated cheese"], "dairy","g",N,N,N,True,30,"g",500,True,0,0,1,0),
 ("parmesan", ["parmigiano","parmesan cheese","grated parmesan"], "dairy","g",N,N,N,True,60,"g",200,True,0,0,1,0),
 ("mozzarella", ["pizza cheese","fresh mozzarella"], "dairy","g",N,125,N,False,21,"g",250,True,0,0,1,0),
 ("feta", ["feta cheese","greek feta"], "dairy","g",N,N,N,False,30,"g",200,True,0,0,1,0),
 ("halloumi", ["haloumi"], "dairy","g",N,180,N,False,30,"g",180,False,0,0,1,0),
 ("ricotta", ["ricotta cheese"], "dairy","g",1.0,N,N,False,10,"g",250,True,0,0,1,0),
 ("cream cheese", ["philadelphia"], "dairy","g",1.0,N,N,False,21,"g",250,True,0,0,1,0),
 ("eggs", ["egg","large eggs","free range eggs"], "dairy","each",N,55,N,True,28,"each",12,False,0,0,0,0),
 ("coconut milk", ["tinned coconut milk","canned coconut milk"], "pantry","ml",1.0,N,N,True,730,"ml",400,False,0,0,0,0),
 ("coconut cream", ["tinned coconut cream"], "pantry","ml",1.0,N,N,False,730,"ml",400,False,0,0,0,0),
]

# ---------------------------------------------------------------- bakery
BAKERY = [
 ("bread", ["sliced bread","white bread","sourdough","loaf"], "bakery","g",N,700,N,True,6,"each",1,False,0,0,0,1),
 ("naan bread", ["naan","garlic naan"], "bakery","each",N,90,N,False,10,"each",4,False,0,0,0,1),
 ("pita bread", ["pita","pitta","flatbread","lebanese bread"], "bakery","each",N,60,N,False,10,"each",6,False,0,0,0,1),
 ("tortillas", ["wraps","flour tortillas","soft tacos"], "bakery","each",N,45,N,False,21,"each",8,False,0,0,0,1),
 ("burger buns", ["brioche buns","hamburger buns"], "bakery","each",N,70,N,False,7,"each",6,False,0,0,0,1),
 ("breadcrumbs", ["panko","panko breadcrumbs","dried breadcrumbs"], "pantry","g",0.25,N,N,True,180,"g",200,False,0,0,0,1),
 ("dumpling wrappers", ["gow gee wrappers","wonton wrappers","dumpling skins"], "frozen","each",N,6,N,False,60,"each",30,False,0,0,0,1),
 ("puff pastry", ["frozen puff pastry","pastry sheets"], "frozen","each",N,175,N,False,180,"each",6,False,0,0,0,1),
]

# ---------------------------------------------------------------- pantry
PANTRY = [
 ("olive oil", ["extra virgin olive oil","evoo"], "pantry","ml",0.918,N,N,True,540,"ml",750,False,0,0,0,0),
 ("vegetable oil", ["canola oil","sunflower oil","neutral oil"], "pantry","ml",0.92,N,N,True,540,"ml",750,False,0,0,0,0),
 ("avocado oil", [], "pantry","ml",0.918,N,N,False,365,"ml",500,False,0,0,0,0),
 ("sesame oil", ["toasted sesame oil"], "pantry","ml",0.92,N,N,True,365,"ml",250,False,0,0,0,0),
 ("coconut oil", [], "pantry","ml",0.92,N,N,False,540,"ml",500,False,0,0,0,0),
 ("soy sauce", ["light soy sauce","dark soy sauce","kecap asin"], "pantry","ml",1.15,N,N,True,730,"ml",500,False,0,0,0,1),
 ("oyster sauce", [], "pantry","ml",1.3,N,N,True,540,"ml",500,False,0,1,0,1),
 ("hoisin sauce", [], "pantry","ml",1.25,N,N,False,540,"ml",250,False,0,0,0,1),
 ("chilli crisp", ["chili crisp","chilli oil","lao gan ma"], "pantry","ml",0.95,N,N,False,365,"ml",200,False,0,0,0,0),
 ("sriracha", ["sriracha sauce","hot sauce"], "pantry","ml",1.1,N,N,False,540,"ml",480,False,0,0,0,0),
 ("worcestershire sauce", ["worcester sauce"], "pantry","ml",1.1,N,N,True,730,"ml",250,False,0,1,0,0),
 ("rice vinegar", ["rice wine vinegar"], "pantry","ml",1.0,N,N,True,730,"ml",250,False,0,0,0,0),
 ("white vinegar", ["distilled vinegar"], "pantry","ml",1.0,N,N,True,730,"ml",500,False,0,0,0,0),
 ("balsamic vinegar", ["balsamic"], "pantry","ml",1.06,N,N,True,730,"ml",250,False,0,0,0,0),
 ("apple cider vinegar", ["acv"], "pantry","ml",1.0,N,N,False,730,"ml",500,False,0,0,0,0),
 ("dijon mustard", ["dijon"], "pantry","g",1.05,N,N,True,365,"g",200,False,0,0,0,0),
 ("wholegrain mustard", ["seeded mustard"], "pantry","g",1.05,N,N,False,365,"g",200,False,0,0,0,0),
 ("tomato paste", ["tomato puree","concentrated tomato paste"], "pantry","g",1.07,N,N,True,540,"g",140,False,0,0,0,0),
 ("chopped tomatoes", ["tinned tomatoes","canned tomatoes","diced tomatoes","crushed tomatoes"], "pantry","g",1.0,N,N,True,730,"g",400,False,0,0,0,0),
 ("passata", ["tomato passata","sieved tomatoes"], "pantry","ml",1.05,N,N,False,540,"ml",700,False,0,0,0,0),
 ("tomato sauce", ["ketchup"], "pantry","ml",1.1,N,N,True,540,"ml",500,False,0,0,0,0),
 ("mayonnaise", ["mayo","whole egg mayonnaise"], "pantry","g",0.91,N,N,True,180,"g",400,False,0,0,0,0),
 ("chicken stock", ["chicken broth","chicken stock cube","liquid chicken stock"], "pantry","ml",1.0,N,N,True,365,"ml",1000,False,1,0,0,0),
 ("beef stock", ["beef broth","beef stock cube"], "pantry","ml",1.0,N,N,True,365,"ml",1000,False,1,0,0,0),
 ("vegetable stock", ["vegetable broth","veg stock"], "pantry","ml",1.0,N,N,True,365,"ml",1000,False,0,0,0,0),
 ("plain flour", ["all purpose flour","flour"], "pantry","g",0.53,N,N,True,365,"g",1000,False,0,0,0,1),
 ("self raising flour", ["self-raising flour"], "pantry","g",0.53,N,N,False,365,"g",1000,False,0,0,0,1),
 ("cornflour", ["cornstarch","corn flour"], "pantry","g",0.55,N,N,True,540,"g",300,False,0,0,0,0),
 ("caster sugar", ["superfine sugar","white sugar","sugar"], "pantry","g",0.85,N,N,True,730,"g",1000,False,0,0,0,0),
 ("brown sugar", ["light brown sugar","dark brown sugar","soft brown sugar"], "pantry","g",0.8,N,N,True,540,"g",500,False,0,0,0,0),
 ("honey", ["raw honey"], "pantry","g",1.42,N,N,True,730,"g",500,False,0,0,0,0),
 ("maple syrup", ["pure maple syrup"], "pantry","ml",1.32,N,N,False,365,"ml",250,False,0,0,0,0),
 ("rice", ["jasmine rice","basmati rice","long grain rice","white rice"], "pantry","g",0.85,N,N,True,730,"g",1000,False,0,0,0,0),
 ("arborio rice", ["risotto rice"], "pantry","g",0.85,N,N,False,730,"g",1000,False,0,0,0,0),
 ("pasta", ["spaghetti","penne","fusilli","rigatoni","dried pasta"], "pantry","g",N,N,N,True,730,"g",500,False,0,0,0,1),
 ("egg noodles", ["hokkien noodles","wheat noodles"], "pantry","g",N,N,N,False,365,"g",400,False,0,0,0,1),
 ("rice noodles", ["vermicelli","pad thai noodles"], "pantry","g",N,N,N,False,540,"g",250,False,0,0,0,0),
 ("couscous", [], "pantry","g",0.72,N,N,False,540,"g",500,False,0,0,0,1),
 ("quinoa", [], "pantry","g",0.75,N,N,False,540,"g",500,False,0,0,0,0),
 ("rolled oats", ["oats","porridge oats"], "pantry","g",0.4,N,N,True,365,"g",1000,False,0,0,0,1),
 ("red lentils", ["lentils","split red lentils"], "pantry","g",0.85,N,N,False,730,"g",500,False,0,0,0,0),
 ("chickpeas", ["tinned chickpeas","canned chickpeas","garbanzo beans"], "pantry","g",N,N,N,True,730,"g",400,False,0,0,0,0),
 ("black beans", ["tinned black beans"], "pantry","g",N,N,N,False,730,"g",400,False,0,0,0,0),
 ("kidney beans", ["red kidney beans"], "pantry","g",N,N,N,False,730,"g",400,False,0,0,0,0),
 ("cannellini beans", ["white beans"], "pantry","g",N,N,N,False,730,"g",400,False,0,0,0,0),
 ("peanut butter", ["crunchy peanut butter","smooth peanut butter"], "pantry","g",1.1,N,N,True,365,"g",500,False,0,0,0,0),
 ("tahini", ["sesame paste"], "pantry","g",1.05,N,N,False,365,"g",350,False,0,0,0,0),
 ("cashews", ["raw cashews","cashew nuts"], "pantry","g",0.55,N,N,False,180,"g",250,True,0,0,0,0),
 ("almonds", ["flaked almonds","slivered almonds"], "pantry","g",0.5,N,N,False,180,"g",250,True,0,0,0,0),
 ("peanuts", ["roasted peanuts"], "pantry","g",0.6,N,N,False,180,"g",250,True,0,0,0,0),
 ("sesame seeds", ["toasted sesame seeds","white sesame seeds"], "pantry","g",0.6,N,N,True,365,"g",100,False,0,0,0,0),
 ("baking powder", [], "pantry","g",0.9,N,N,True,540,"g",125,False,0,0,0,0),
 ("bicarb soda", ["baking soda","bicarbonate of soda"], "pantry","g",0.9,N,N,True,730,"g",125,False,0,0,0,0),
 ("vanilla extract", ["vanilla essence","vanilla"], "pantry","ml",0.88,N,N,True,730,"ml",50,False,0,0,0,0),
 ("cocoa powder", ["dutch cocoa","unsweetened cocoa"], "pantry","g",0.42,N,N,False,540,"g",250,False,0,0,0,0),
 ("dark chocolate", ["cooking chocolate","chocolate"], "pantry","g",N,N,N,False,365,"g",180,True,0,0,0,0),
 ("gochujang", ["korean chilli paste"], "pantry","g",1.2,N,N,False,365,"g",500,False,0,0,0,1),
 ("miso paste", ["white miso","shiro miso"], "pantry","g",1.2,N,N,False,365,"g",300,False,0,0,0,1),
 ("curry paste", ["red curry paste","green curry paste","thai curry paste"], "pantry","g",1.1,N,N,False,365,"g",200,False,0,1,0,0),
 ("ginger garlic paste", ["ginger and garlic paste"], "pantry","ml",1.1,N,N,False,180,"ml",200,False,0,0,0,0),
 ("mirin", [], "pantry","ml",1.05,N,N,False,730,"ml",250,False,0,0,0,0),
 ("shaoxing wine", ["chinese cooking wine","shao xing"], "pantry","ml",0.99,N,N,False,730,"ml",640,False,0,0,0,1),
 ("olives", ["kalamata olives","green olives","pitted olives"], "pantry","g",N,4,N,False,365,"g",235,True,0,0,0,0),
 ("capers", ["baby capers"], "pantry","g",N,1,N,False,365,"g",100,False,0,0,0,0),
 ("gherkins", ["pickles","dill pickles"], "pantry","g",N,25,N,False,365,"g",500,True,0,0,0,0),
 ("sundried tomatoes", ["semi dried tomatoes"], "pantry","g",N,5,N,False,180,"g",280,True,0,0,0,0),
 ("nutritional yeast", ["nooch"], "pantry","g",0.25,N,N,False,365,"g",100,False,0,0,0,0),
]

# ---------------------------------------------------------------- spice
SPICE = [
 ("salt", ["sea salt","table salt","cooking salt","kosher salt","salt flakes"], "spice","g",1.2,N,N,True,1825,"g",1000,False,0,0,0,0),
 ("black pepper", ["pepper","cracked pepper","ground black pepper","peppercorns"], "spice","g",0.5,N,N,True,730,"g",100,False,0,0,0,0),
 ("white pepper", ["ground white pepper"], "spice","g",0.5,N,N,False,730,"g",50,False,0,0,0,0),
 ("cumin", ["ground cumin","cumin seeds"], "spice","g",0.45,N,N,True,540,"g",60,False,0,0,0,0),
 ("ground coriander", ["coriander powder","ground coriander seed"], "spice","g",0.4,N,N,True,540,"g",50,False,0,0,0,0),
 ("turmeric", ["ground turmeric","tumeric"], "spice","g",0.5,N,N,True,540,"g",50,False,0,0,0,0),
 ("paprika", ["sweet paprika"], "spice","g",0.45,N,N,True,540,"g",50,False,0,0,0,0),
 ("smoked paprika", ["pimenton"], "spice","g",0.45,N,N,True,540,"g",50,False,0,0,0,0),
 ("cayenne pepper", ["cayenne","ground cayenne"], "spice","g",0.45,N,N,True,540,"g",40,False,0,0,0,0),
 ("chilli powder", ["chili powder","chilli flakes","red pepper flakes","dried chilli flakes"], "spice","g",0.45,N,N,True,540,"g",50,False,0,0,0,0),
 ("garam masala", [], "spice","g",0.42,N,N,True,365,"g",60,False,0,0,0,0),
 ("curry powder", ["madras curry powder"], "spice","g",0.42,N,N,False,365,"g",60,False,0,0,0,0),
 ("fenugreek", ["kasuri methi","dried fenugreek leaves","fenugreek seeds"], "spice","g",0.4,N,N,False,540,"g",50,False,0,0,0,0),
 ("cinnamon", ["ground cinnamon","cinnamon stick"], "spice","g",0.45,N,N,True,730,"g",50,False,0,0,0,0),
 ("nutmeg", ["ground nutmeg"], "spice","g",0.5,N,N,False,730,"g",40,False,0,0,0,0),
 ("cardamom", ["ground cardamom","cardamom pods"], "spice","g",0.4,N,N,False,540,"g",30,False,0,0,0,0),
 ("cloves", ["ground cloves","whole cloves"], "spice","g",0.45,N,N,False,730,"g",30,False,0,0,0,0),
 ("star anise", [], "spice","each",N,1,N,False,730,"g",25,False,0,0,0,0),
 ("bay leaves", ["bay leaf","dried bay leaves"], "spice","each",N,0.2,N,True,540,"g",5,False,0,0,0,0),
 ("dried oregano", ["oregano"], "spice","g",0.2,N,N,True,540,"g",30,False,0,0,0,0),
 ("dried thyme", [], "spice","g",0.2,N,N,False,540,"g",25,False,0,0,0,0),
 ("dried rosemary", [], "spice","g",0.2,N,N,False,540,"g",25,False,0,0,0,0),
 ("mixed herbs", ["italian herbs","dried mixed herbs"], "spice","g",0.2,N,N,True,540,"g",30,False,0,0,0,0),
 ("onion powder", [], "spice","g",0.45,N,N,False,540,"g",50,False,0,0,0,0),
 ("garlic powder", ["granulated garlic"], "spice","g",0.45,N,N,True,540,"g",50,False,0,0,0,0),
 ("mustard powder", ["dry mustard","english mustard powder"], "spice","g",0.45,N,N,False,540,"g",50,False,0,0,0,0),
 ("chinese five spice", ["five spice"], "spice","g",0.42,N,N,False,540,"g",40,False,0,0,0,0),
 ("za'atar", ["zaatar"], "spice","g",0.35,N,N,False,365,"g",50,False,0,0,0,1),
 ("sumac", ["ground sumac"], "spice","g",0.4,N,N,False,365,"g",50,False,0,0,0,0),
 ("dukkah", [], "spice","g",0.4,N,N,False,180,"g",100,False,0,0,0,0),
 ("saffron", ["saffron threads"], "spice","g",0.2,N,N,False,730,"g",1,False,0,0,0,0),
 ("mustard seeds", ["black mustard seeds","yellow mustard seeds"], "spice","g",0.6,N,N,False,730,"g",50,False,0,0,0,0),
 ("fennel seeds", [], "spice","g",0.4,N,N,False,730,"g",40,False,0,0,0,0),
 ("caraway seeds", [], "spice","g",0.45,N,N,False,730,"g",40,False,0,0,0,0),
 ("allspice", ["ground allspice","pimento"], "spice","g",0.45,N,N,False,730,"g",40,False,0,0,0,0),
 ("ras el hanout", [], "spice","g",0.42,N,N,False,365,"g",50,False,0,0,0,0),
 ("stock powder", ["chicken salt","vegeta","stock cube"], "spice","g",0.6,N,N,False,540,"g",120,False,0,0,0,0),
]

# ---------------------------------------------------------------- frozen / drinks / household
OTHER = [
 ("frozen peas", ["peas","garden peas"], "frozen","g",0.65,N,N,True,365,"g",500,True,0,0,0,0),
 ("frozen corn", ["corn kernels"], "frozen","g",0.65,N,N,False,365,"g",500,True,0,0,0,0),
 ("frozen spinach", [], "frozen","g",0.8,N,N,False,365,"g",250,True,0,0,0,0),
 ("frozen berries", ["mixed berries","frozen raspberries"], "frozen","g",0.6,N,N,False,365,"g",500,True,0,0,0,0),
 ("ice cream", ["vanilla ice cream"], "frozen","ml",0.55,N,N,False,180,"ml",1000,False,0,0,1,0),
 ("frozen chips", ["oven chips","potato chips frozen"], "frozen","g",0.55,N,N,False,365,"g",1000,True,0,0,0,0),
 ("white wine", ["dry white wine","cooking wine"], "drinks","ml",0.99,N,N,False,365,"ml",750,False,0,0,0,0),
 ("red wine", ["dry red wine"], "drinks","ml",0.99,N,N,False,365,"ml",750,False,0,0,0,0),
 ("beer", ["lager","pale ale"], "drinks","ml",1.0,N,N,False,180,"ml",375,False,0,0,0,1),
 ("water", ["cold water","boiling water","warm water"], "pantry","ml",1.0,N,N,True,N,"ml",1000,False,0,0,0,0),
 ("ice", ["ice cubes"], "frozen","g",0.92,N,N,False,N,"g",2000,True,0,0,0,0),
]

ALL = PRODUCE + MEAT + SEAFOOD + DAIRY + BAKERY + PANTRY + SPICE + OTHER


def esc(s):
    return s.replace("'", "''")


def arr(lst):
    if not lst:
        return "'{}'"
    return "array[" + ",".join("'" + esc(a) + "'" for a in lst) + "]"


def num(v):
    return "null" if v is None else str(v)


def boolv(v):
    return "true" if v else "false"


def main():
    seen = set()
    rows = []
    alias_seen = {}

    for r in ALL:
        assert len(r) == COLS, f"{r[0]}: {len(r)} cols, expected {COLS}"
        (name, aliases, cat, du, gpm, gpe, mpe, staple, life,
         pu, pack, div, meat, fish, dairy, gluten) = r

        assert name not in seen, f"duplicate canonical name: {name}"
        seen.add(name)
        for a in aliases:
            if a in alias_seen:
                raise AssertionError(f"alias '{a}' on both {alias_seen[a]} and {name}")
            alias_seen[a] = name
        assert du in ("g", "ml", "each"), f"{name}: bad unit {du}"
        assert pu in ("g", "ml", "each", None), f"{name}: bad purchase unit {pu}"

        rows.append(
            "  ('{n}', {al}, '{c}', '{du}', {gpm}, {gpe}, {mpe}, {st}, {lf}, "
            "'{pu}', {pk}, {dv}, {mt}, {fh}, {dy}, {gl})".format(
                n=esc(name), al=arr(aliases), c=cat, du=du,
                gpm=num(gpm), gpe=num(gpe), mpe=num(mpe),
                st=boolv(staple), lf=num(life), pu=pu, pk=num(pack),
                dv=boolv(div), mt=boolv(meat), fh=boolv(fish),
                dy=boolv(dairy), gl=boolv(gluten)))

    header = """-- ============================================================
-- Chop — 003_seed_ingredients.sql
--
-- {count} canonical ingredients, Australian products and pack sizes.
-- Macros are left null; they get loaded from AFCD in phase 6.
--
-- ml_per_each is the YIELD of one whole item:
--   lemon  -> 45 ml juice
--   garlic -> 5 ml crushed (one clove ~ 1 tsp)
-- This is how "juice of 1 lemon", "1 tbsp lemon juice" and
-- "juice of 1/2 lemon" all resolve to the same canonical row.
--
-- divisible = true  -> buy the shortfall (weighed goods)
-- divisible = false -> buy whole packs (cans, jars, bottles)
-- ============================================================

insert into ingredients (
  canonical_name, aliases, category, default_unit,
  g_per_ml, g_per_each, ml_per_each,
  is_staple, shelf_life_days,
  purchase_unit, pack_size, divisible,
  is_meat, is_fish, is_dairy, is_gluten
) values
""".format(count=len(rows))

    sql = header + ",\n".join(rows) + "\non conflict (canonical_name) do nothing;\n"

    footer = """
-- ============================================================
-- Sanity checks — run these after seeding
-- ============================================================

-- Every fixture ingredient should resolve above 0.75.
-- select * from match_ingredient('tumeric');
-- select * from match_ingredient('ground pork');
-- select * from match_ingredient('green onions, thinly sliced');
-- select * from match_ingredient('heavy whipping cream');
-- select * from match_ingredient('boneless skinless chicken thighs');

-- Staple coverage drives cook_from_stock ranking quality.
-- select category, count(*) filter (where is_staple) as staples, count(*)
-- from ingredients group by category order by category;

-- Anything volume-measured without a density can't convert to grams.
-- select canonical_name from ingredients
-- where g_per_ml is null and default_unit = 'ml';
"""

    with open("/mnt/user-data/outputs/003_seed_ingredients.sql", "w") as f:
        f.write(sql + footer)

    print(f"rows: {len(rows)}")
    print(f"aliases: {len(alias_seen)}")
    from collections import Counter
    c = Counter(r[2] for r in ALL)
    for k, v in sorted(c.items()):
        print(f"  {k}: {v}")
    print(f"staples: {sum(1 for r in ALL if r[7])}")


if __name__ == "__main__":
    main()
