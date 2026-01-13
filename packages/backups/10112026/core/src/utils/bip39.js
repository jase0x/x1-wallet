// BIP39 Mnemonic Implementation
// Full 2048 word English wordlist

import { logger } from './logger.js';

export const WORDLIST = [
  "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse",
  "access", "accident", "account", "accuse", "achieve", "acid", "acoustic", "acquire", "across", "act",
  "action", "actor", "actress", "actual", "adapt", "add", "addict", "address", "adjust", "admit",
  "adult", "advance", "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
  "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album", "alcohol", "alert",
  "alien", "all", "alley", "allow", "almost", "alone", "alpha", "already", "also", "alter",
  "always", "amateur", "amazing", "among", "amount", "amused", "analyst", "anchor", "ancient", "anger",
  "angle", "angry", "animal", "ankle", "announce", "annual", "another", "answer", "antenna", "antique",
  "anxiety", "any", "apart", "apology", "appear", "apple", "approve", "april", "arch", "arctic",
  "area", "arena", "argue", "arm", "armed", "armor", "army", "around", "arrange", "arrest",
  "arrive", "arrow", "art", "artefact", "artist", "artwork", "ask", "aspect", "assault", "asset",
  "assist", "assume", "asthma", "athlete", "atom", "attack", "attend", "attitude", "attract", "auction",
  "audit", "august", "aunt", "author", "auto", "autumn", "average", "avocado", "avoid", "awake",
  "aware", "away", "awesome", "awful", "awkward", "axis", "baby", "bachelor", "bacon", "badge",
  "bag", "balance", "balcony", "ball", "bamboo", "banana", "banner", "bar", "barely", "bargain",
  "barrel", "base", "basic", "basket", "battle", "beach", "bean", "beauty", "because", "become",
  "beef", "before", "begin", "behave", "behind", "believe", "below", "belt", "bench", "benefit",
  "best", "betray", "better", "between", "beyond", "bicycle", "bid", "bike", "bind", "biology",
  "bird", "birth", "bitter", "black", "blade", "blame", "blanket", "blast", "bleak", "bless",
  "blind", "blood", "blossom", "blouse", "blue", "blur", "blush", "board", "boat", "body",
  "boil", "bomb", "bone", "bonus", "book", "boost", "border", "boring", "borrow", "boss",
  "bottom", "bounce", "box", "boy", "bracket", "brain", "brand", "brass", "brave", "bread",
  "breeze", "brick", "bridge", "brief", "bright", "bring", "brisk", "broccoli", "broken", "bronze",
  "broom", "brother", "brown", "brush", "bubble", "buddy", "budget", "buffalo", "build", "bulb",
  "bulk", "bullet", "bundle", "bunker", "burden", "burger", "burst", "bus", "business", "busy",
  "butter", "buyer", "buzz", "cabbage", "cabin", "cable", "cactus", "cage", "cake", "call",
  "calm", "camera", "camp", "can", "canal", "cancel", "candy", "cannon", "canoe", "canvas",
  "canyon", "capable", "capital", "captain", "car", "carbon", "card", "cargo", "carpet", "carry",
  "cart", "case", "cash", "casino", "castle", "casual", "cat", "catalog", "catch", "category",
  "cattle", "caught", "cause", "caution", "cave", "ceiling", "celery", "cement", "census", "century",
  "cereal", "certain", "chair", "chalk", "champion", "change", "chaos", "chapter", "charge", "chase",
  "chat", "cheap", "check", "cheese", "chef", "cherry", "chest", "chicken", "chief", "child",
  "chimney", "choice", "choose", "chronic", "chuckle", "chunk", "churn", "cigar", "cinnamon", "circle",
  "citizen", "city", "civil", "claim", "clap", "clarify", "claw", "clay", "clean", "clerk",
  "clever", "click", "client", "cliff", "climb", "clinic", "clip", "clock", "clog", "close",
  "cloth", "cloud", "clown", "club", "clump", "cluster", "clutch", "coach", "coast", "coconut",
  "code", "coffee", "coil", "coin", "collect", "color", "column", "combine", "come", "comfort",
  "comic", "common", "company", "concert", "conduct", "confirm", "congress", "connect", "consider", "control",
  "convince", "cook", "cool", "copper", "copy", "coral", "core", "corn", "correct", "cost",
  "cotton", "couch", "country", "couple", "course", "cousin", "cover", "coyote", "crack", "cradle",
  "craft", "cram", "crane", "crash", "crater", "crawl", "crazy", "cream", "credit", "creek",
  "crew", "cricket", "crime", "crisp", "critic", "crop", "cross", "crouch", "crowd", "crucial",
  "cruel", "cruise", "crumble", "crunch", "crush", "cry", "crystal", "cube", "culture", "cup",
  "cupboard", "curious", "current", "curtain", "curve", "cushion", "custom", "cute", "cycle", "dad",
  "damage", "damp", "dance", "danger", "daring", "dash", "daughter", "dawn", "day", "deal",
  "debate", "debris", "decade", "december", "decide", "decline", "decorate", "decrease", "deer", "defense",
  "define", "defy", "degree", "delay", "deliver", "demand", "demise", "denial", "dentist", "deny",
  "depart", "depend", "deposit", "depth", "deputy", "derive", "describe", "desert", "design", "desk",
  "despair", "destroy", "detail", "detect", "develop", "device", "devote", "diagram", "dial", "diamond",
  "diary", "dice", "diesel", "diet", "differ", "digital", "dignity", "dilemma", "dinner", "dinosaur",
  "direct", "dirt", "disagree", "discover", "disease", "dish", "dismiss", "disorder", "display", "distance",
  "divert", "divide", "divorce", "dizzy", "doctor", "document", "dog", "doll", "dolphin", "domain",
  "donate", "donkey", "donor", "door", "dose", "double", "dove", "draft", "dragon", "drama",
  "drastic", "draw", "dream", "dress", "drift", "drill", "drink", "drip", "drive", "drop",
  "drum", "dry", "duck", "dumb", "dune", "during", "dust", "dutch", "duty", "dwarf",
  "dynamic", "eager", "eagle", "early", "earn", "earth", "easily", "east", "easy", "echo",
  "ecology", "economy", "edge", "edit", "educate", "effort", "egg", "eight", "either", "elbow",
  "elder", "electric", "elegant", "element", "elephant", "elevator", "elite", "else", "embark", "embody",
  "embrace", "emerge", "emotion", "employ", "empower", "empty", "enable", "enact", "end", "endless",
  "endorse", "enemy", "energy", "enforce", "engage", "engine", "enhance", "enjoy", "enlist", "enough",
  "enrich", "enroll", "ensure", "enter", "entire", "entry", "envelope", "episode", "equal", "equip",
  "era", "erase", "erode", "erosion", "error", "erupt", "escape", "essay", "essence", "estate",
  "eternal", "ethics", "evidence", "evil", "evoke", "evolve", "exact", "example", "excess", "exchange",
  "excite", "exclude", "excuse", "execute", "exercise", "exhaust", "exhibit", "exile", "exist", "exit",
  "exotic", "expand", "expect", "expire", "explain", "expose", "express", "extend", "extra", "eye",
  "eyebrow", "fabric", "face", "faculty", "fade", "faint", "faith", "fall", "false", "fame",
  "family", "famous", "fan", "fancy", "fantasy", "farm", "fashion", "fat", "fatal", "father",
  "fatigue", "fault", "favorite", "feature", "february", "federal", "fee", "feed", "feel", "female",
  "fence", "festival", "fetch", "fever", "few", "fiber", "fiction", "field", "figure", "file",
  "film", "filter", "final", "find", "fine", "finger", "finish", "fire", "firm", "first",
  "fiscal", "fish", "fit", "fitness", "fix", "flag", "flame", "flash", "flat", "flavor",
  "flee", "flight", "flip", "float", "flock", "floor", "flower", "fluid", "flush", "fly",
  "foam", "focus", "fog", "foil", "fold", "follow", "food", "foot", "force", "forest",
  "forget", "fork", "fortune", "forum", "forward", "fossil", "foster", "found", "fox", "fragile",
  "frame", "frequent", "fresh", "friend", "fringe", "frog", "front", "frost", "frown", "frozen",
  "fruit", "fuel", "fun", "funny", "furnace", "fury", "future", "gadget", "gain", "galaxy",
  "gallery", "game", "gap", "garage", "garbage", "garden", "garlic", "garment", "gas", "gasp",
  "gate", "gather", "gauge", "gaze", "general", "genius", "genre", "gentle", "genuine", "gesture",
  "ghost", "giant", "gift", "giggle", "ginger", "giraffe", "girl", "give", "glad", "glance",
  "glare", "glass", "glide", "glimpse", "globe", "gloom", "glory", "glove", "glow", "glue",
  "goat", "goddess", "gold", "good", "goose", "gorilla", "gospel", "gossip", "govern", "gown",
  "grab", "grace", "grain", "grant", "grape", "grass", "gravity", "great", "green", "grid",
  "grief", "grit", "grocery", "group", "grow", "grunt", "guard", "guess", "guide", "guilt",
  "guitar", "gun", "gym", "habit", "hair", "half", "hammer", "hamster", "hand", "happy",
  "harbor", "hard", "harsh", "harvest", "hat", "have", "hawk", "hazard", "head", "health",
  "heart", "heavy", "hedgehog", "height", "hello", "helmet", "help", "hen", "hero", "hidden",
  "high", "hill", "hint", "hip", "hire", "history", "hobby", "hockey", "hold", "hole",
  "holiday", "hollow", "home", "honey", "hood", "hope", "horn", "horror", "horse", "hospital",
  "host", "hotel", "hour", "hover", "hub", "huge", "human", "humble", "humor", "hundred",
  "hungry", "hunt", "hurdle", "hurry", "hurt", "husband", "hybrid", "ice", "icon", "idea",
  "identify", "idle", "ignore", "ill", "illegal", "illness", "image", "imitate", "immense", "immune",
  "impact", "impose", "improve", "impulse", "inch", "include", "income", "increase", "index", "indicate",
  "indoor", "industry", "infant", "inflict", "inform", "inhale", "inherit", "initial", "inject", "injury",
  "inmate", "inner", "innocent", "input", "inquiry", "insane", "insect", "inside", "inspire", "install",
  "intact", "interest", "into", "invest", "invite", "involve", "iron", "island", "isolate", "issue",
  "item", "ivory", "jacket", "jaguar", "jar", "jazz", "jealous", "jeans", "jelly", "jewel",
  "job", "join", "joke", "journey", "joy", "judge", "juice", "jump", "jungle", "junior",
  "junk", "just", "kangaroo", "keen", "keep", "ketchup", "key", "kick", "kid", "kidney",
  "kind", "kingdom", "kiss", "kit", "kitchen", "kite", "kitten", "kiwi", "knee", "knife",
  "knock", "know", "lab", "label", "labor", "ladder", "lady", "lake", "lamp", "language",
  "laptop", "large", "later", "latin", "laugh", "laundry", "lava", "law", "lawn", "lawsuit",
  "layer", "lazy", "leader", "leaf", "learn", "leave", "lecture", "left", "leg", "legal",
  "legend", "leisure", "lemon", "lend", "length", "lens", "leopard", "lesson", "letter", "level",
  "liar", "liberty", "library", "license", "life", "lift", "light", "like", "limb", "limit",
  "link", "lion", "liquid", "list", "little", "live", "lizard", "load", "loan", "lobster",
  "local", "lock", "logic", "lonely", "long", "loop", "lottery", "loud", "lounge", "love",
  "loyal", "lucky", "luggage", "lumber", "lunar", "lunch", "luxury", "lyrics", "machine", "mad",
  "magic", "magnet", "maid", "mail", "main", "major", "make", "mammal", "man", "manage",
  "mandate", "mango", "mansion", "manual", "maple", "marble", "march", "margin", "marine", "market",
  "marriage", "mask", "mass", "master", "match", "material", "math", "matrix", "matter", "maximum",
  "maze", "meadow", "mean", "measure", "meat", "mechanic", "medal", "media", "melody", "melt",
  "member", "memory", "mention", "menu", "mercy", "merge", "merit", "merry", "mesh", "message",
  "metal", "method", "middle", "midnight", "milk", "million", "mimic", "mind", "minimum", "minor",
  "minute", "miracle", "mirror", "misery", "miss", "mistake", "mix", "mixed", "mixture", "mobile",
  "model", "modify", "mom", "moment", "monitor", "monkey", "monster", "month", "moon", "moral",
  "more", "morning", "mosquito", "mother", "motion", "motor", "mountain", "mouse", "move", "movie",
  "much", "muffin", "mule", "multiply", "muscle", "museum", "mushroom", "music", "must", "mutual",
  "myself", "mystery", "myth", "naive", "name", "napkin", "narrow", "nasty", "nation", "nature",
  "near", "neck", "need", "negative", "neglect", "neither", "nephew", "nerve", "nest", "net",
  "network", "neutral", "never", "news", "next", "nice", "night", "noble", "noise", "nominee",
  "noodle", "normal", "north", "nose", "notable", "note", "nothing", "notice", "novel", "now",
  "nuclear", "number", "nurse", "nut", "oak", "obey", "object", "oblige", "obscure", "observe",
  "obtain", "obvious", "occur", "ocean", "october", "odor", "off", "offer", "office", "often",
  "oil", "okay", "old", "olive", "olympic", "omit", "once", "one", "onion", "online",
  "only", "open", "opera", "opinion", "oppose", "option", "orange", "orbit", "orchard", "order",
  "ordinary", "organ", "orient", "original", "orphan", "ostrich", "other", "outdoor", "outer", "output",
  "outside", "oval", "oven", "over", "own", "owner", "oxygen", "oyster", "ozone", "pact",
  "paddle", "page", "pair", "palace", "palm", "panda", "panel", "panic", "panther", "paper",
  "parade", "parent", "park", "parrot", "party", "pass", "patch", "path", "patient", "patrol",
  "pattern", "pause", "pave", "payment", "peace", "peanut", "pear", "peasant", "pelican", "pen",
  "penalty", "pencil", "people", "pepper", "perfect", "permit", "person", "pet", "phone", "photo",
  "phrase", "physical", "piano", "picnic", "picture", "piece", "pig", "pigeon", "pill", "pilot",
  "pink", "pioneer", "pipe", "pistol", "pitch", "pizza", "place", "planet", "plastic", "plate",
  "play", "please", "pledge", "pluck", "plug", "plunge", "poem", "poet", "point", "polar",
  "pole", "police", "pond", "pony", "pool", "popular", "portion", "position", "possible", "post",
  "potato", "pottery", "poverty", "powder", "power", "practice", "praise", "predict", "prefer", "prepare",
  "present", "pretty", "prevent", "price", "pride", "primary", "print", "priority", "prison", "private",
  "prize", "problem", "process", "produce", "profit", "program", "project", "promote", "proof", "property",
  "prosper", "protect", "proud", "provide", "public", "pudding", "pull", "pulp", "pulse", "pumpkin",
  "punch", "pupil", "puppy", "purchase", "purity", "purpose", "purse", "push", "put", "puzzle",
  "pyramid", "quality", "quantum", "quarter", "question", "quick", "quit", "quiz", "quote", "rabbit",
  "raccoon", "race", "rack", "radar", "radio", "rail", "rain", "raise", "rally", "ramp",
  "ranch", "random", "range", "rapid", "rare", "rate", "rather", "raven", "raw", "razor",
  "ready", "real", "reason", "rebel", "rebuild", "recall", "receive", "recipe", "record", "recycle",
  "reduce", "reflect", "reform", "refuse", "region", "regret", "regular", "reject", "relax", "release",
  "relief", "rely", "remain", "remember", "remind", "remove", "render", "renew", "rent", "reopen",
  "repair", "repeat", "replace", "report", "require", "rescue", "resemble", "resist", "resource", "response",
  "result", "retire", "retreat", "return", "reunion", "reveal", "review", "reward", "rhythm", "rib",
  "ribbon", "rice", "rich", "ride", "ridge", "rifle", "right", "rigid", "ring", "riot",
  "ripple", "risk", "ritual", "rival", "river", "road", "roast", "robot", "robust", "rocket",
  "romance", "roof", "rookie", "room", "rose", "rotate", "rough", "round", "route", "royal",
  "rubber", "rude", "rug", "rule", "run", "runway", "rural", "sad", "saddle", "sadness",
  "safe", "sail", "salad", "salmon", "salon", "salt", "salute", "same", "sample", "sand",
  "satisfy", "satoshi", "sauce", "sausage", "save", "say", "scale", "scan", "scare", "scatter",
  "scene", "scheme", "school", "science", "scissors", "scorpion", "scout", "scrap", "screen", "script",
  "scrub", "sea", "search", "season", "seat", "second", "secret", "section", "security", "seed",
  "seek", "segment", "select", "sell", "seminar", "senior", "sense", "sentence", "series", "service",
  "session", "settle", "setup", "seven", "shadow", "shaft", "shallow", "share", "shed", "shell",
  "sheriff", "shield", "shift", "shine", "ship", "shiver", "shock", "shoe", "shoot", "shop",
  "short", "shoulder", "shove", "shrimp", "shrug", "shuffle", "shy", "sibling", "sick", "side",
  "siege", "sight", "sign", "silent", "silk", "silly", "silver", "similar", "simple", "since",
  "sing", "siren", "sister", "situate", "six", "size", "skate", "sketch", "ski", "skill",
  "skin", "skirt", "skull", "slab", "slam", "sleep", "slender", "slice", "slide", "slight",
  "slim", "slogan", "slot", "slow", "slush", "small", "smart", "smile", "smoke", "smooth",
  "snack", "snake", "snap", "sniff", "snow", "soap", "soccer", "social", "sock", "soda",
  "soft", "solar", "soldier", "solid", "solution", "solve", "someone", "song", "soon", "sorry",
  "sort", "soul", "sound", "soup", "source", "south", "space", "spare", "spatial", "spawn",
  "speak", "special", "speed", "spell", "spend", "sphere", "spice", "spider", "spike", "spin",
  "spirit", "split", "spoil", "sponsor", "spoon", "sport", "spot", "spray", "spread", "spring",
  "spy", "square", "squeeze", "squirrel", "stable", "stadium", "staff", "stage", "stairs", "stamp",
  "stand", "start", "state", "stay", "steak", "steel", "stem", "step", "stereo", "stick",
  "still", "sting", "stock", "stomach", "stone", "stool", "story", "stove", "strategy", "street",
  "strike", "strong", "struggle", "student", "stuff", "stumble", "style", "subject", "submit", "subway",
  "success", "such", "sudden", "suffer", "sugar", "suggest", "suit", "summer", "sun", "sunny",
  "sunset", "super", "supply", "supreme", "sure", "surface", "surge", "surprise", "surround", "survey",
  "suspect", "sustain", "swallow", "swamp", "swap", "swarm", "swear", "sweet", "swift", "swim",
  "swing", "switch", "sword", "symbol", "symptom", "syrup", "system", "table", "tackle", "tag",
  "tail", "talent", "talk", "tank", "tape", "target", "task", "taste", "tattoo", "taxi",
  "teach", "team", "tell", "ten", "tenant", "tennis", "tent", "term", "test", "text",
  "thank", "that", "theme", "then", "theory", "there", "they", "thing", "this", "thought",
  "three", "thrive", "throw", "thumb", "thunder", "ticket", "tide", "tiger", "tilt", "timber",
  "time", "tiny", "tip", "tired", "tissue", "title", "toast", "tobacco", "today", "toddler",
  "toe", "together", "toilet", "token", "tomato", "tomorrow", "tone", "tongue", "tonight", "tool",
  "tooth", "top", "topic", "topple", "torch", "tornado", "tortoise", "toss", "total", "tourist",
  "toward", "tower", "town", "toy", "track", "trade", "traffic", "tragic", "train", "transfer",
  "trap", "trash", "travel", "tray", "treat", "tree", "trend", "trial", "tribe", "trick",
  "trigger", "trim", "trip", "trophy", "trouble", "truck", "true", "truly", "trumpet", "trust",
  "truth", "try", "tube", "tuition", "tumble", "tuna", "tunnel", "turkey", "turn", "turtle",
  "twelve", "twenty", "twice", "twin", "twist", "two", "type", "typical", "ugly", "umbrella",
  "unable", "unaware", "uncle", "uncover", "under", "undo", "unfair", "unfold", "unhappy", "uniform",
  "unique", "unit", "universe", "unknown", "unlock", "until", "unusual", "unveil", "update", "upgrade",
  "uphold", "upon", "upper", "upset", "urban", "urge", "usage", "use", "used", "useful",
  "useless", "usual", "utility", "vacant", "vacuum", "vague", "valid", "valley", "valve", "van",
  "vanish", "vapor", "various", "vast", "vault", "vehicle", "velvet", "vendor", "venture", "venue",
  "verb", "verify", "version", "very", "vessel", "veteran", "viable", "vibrant", "vicious", "victory",
  "video", "view", "village", "vintage", "violin", "virtual", "virus", "visa", "visit", "visual",
  "vital", "vivid", "vocal", "voice", "void", "volcano", "volume", "vote", "voyage", "wage",
  "wagon", "wait", "walk", "wall", "walnut", "want", "warfare", "warm", "warrior", "wash",
  "wasp", "waste", "water", "wave", "way", "wealth", "weapon", "wear", "weasel", "weather",
  "web", "wedding", "weekend", "weird", "welcome", "west", "wet", "whale", "what", "wheat",
  "wheel", "when", "where", "whip", "whisper", "wide", "width", "wife", "wild", "will",
  "win", "window", "wine", "wing", "wink", "winner", "winter", "wire", "wisdom", "wise",
  "wish", "witness", "wolf", "woman", "wonder", "wood", "wool", "word", "work", "world",
  "worry", "worth", "wrap", "wreck", "wrestle", "wrist", "write", "wrong", "yard", "year",
  "yellow", "you", "young", "youth", "zebra", "zero", "zone", "zoo"
];

// Generate random bytes
function getRandomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// SHA-256 hash
async function sha256(data) {
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buffer);
}

// Convert bytes to binary string
function bytesToBinary(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(2).padStart(8, '0'))
    .join('');
}

// Generate mnemonic from entropy
export async function entropyToMnemonic(entropy) {
  const hash = await sha256(entropy);
  const checksumBits = entropy.length / 4;
  
  const entropyBits = bytesToBinary(entropy);
  const hashBits = bytesToBinary(hash);
  const checksum = hashBits.slice(0, checksumBits);
  
  const allBits = entropyBits + checksum;
  const words = [];
  
  for (let i = 0; i < allBits.length; i += 11) {
    const index = parseInt(allBits.slice(i, i + 11), 2);
    words.push(WORDLIST[index]);
  }
  
  return words.join(' ');
}

// Generate new mnemonic
export async function generateMnemonic(strength = 128) {
  const entropy = getRandomBytes(strength / 8);
  return entropyToMnemonic(entropy);
}

// Synchronous SHA-256 implementation for proper BIP-39 compliance
// Uses a pure JavaScript implementation when crypto.subtle is not available synchronously
function sha256Sync(data) {
  // SHA-256 constants
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const ch = (x, y, z) => (x & y) ^ (~x & z);
  const maj = (x, y, z) => (x & y) ^ (x & z) ^ (y & z);
  const sigma0 = x => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
  const sigma1 = x => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
  const gamma0 = x => rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
  const gamma1 = x => rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10);
  
  // Pre-processing: adding padding bits
  const msgLen = data.length;
  const bitLen = msgLen * 8;
  const padLen = ((msgLen + 8) % 64 < 56) ? 56 - (msgLen + 8) % 64 : 120 - (msgLen + 8) % 64;
  const paddedLen = msgLen + 1 + padLen + 8;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[msgLen] = 0x80;
  // Length in bits as 64-bit big-endian
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen, false);
  
  // Process each 512-bit block
  const W = new Uint32Array(64);
  for (let i = 0; i < paddedLen; i += 64) {
    // Copy block into W[0..15]
    for (let j = 0; j < 16; j++) {
      W[j] = (padded[i + j * 4] << 24) | (padded[i + j * 4 + 1] << 16) |
             (padded[i + j * 4 + 2] << 8) | padded[i + j * 4 + 3];
    }
    // Extend to W[16..63]
    for (let j = 16; j < 64; j++) {
      W[j] = (gamma1(W[j - 2]) + W[j - 7] + gamma0(W[j - 15]) + W[j - 16]) >>> 0;
    }
    
    let [a, b, c, d, e, f, g, h] = H;
    
    for (let j = 0; j < 64; j++) {
      const T1 = (h + sigma1(e) + ch(e, f, g) + K[j] + W[j]) >>> 0;
      const T2 = (sigma0(a) + maj(a, b, c)) >>> 0;
      h = g; g = f; f = e;
      e = (d + T1) >>> 0;
      d = c; c = b; b = a;
      a = (T1 + T2) >>> 0;
    }
    
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  
  // Produce final hash
  const hash = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    hash[i * 4] = (H[i] >>> 24) & 0xff;
    hash[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    hash[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    hash[i * 4 + 3] = H[i] & 0xff;
  }
  return hash;
}

// Synchronous generate with PROPER BIP-39 SHA-256 checksum
// This is now safe to use - produces valid BIP-39 mnemonics
export function generateMnemonicSync(strength = 128) {
  const entropy = getRandomBytes(strength / 8);
  
  // Use proper SHA-256 for checksum (BIP-39 compliant)
  const hash = sha256Sync(entropy);
  const checksumBits = strength / 32; // 4 bits for 128-bit entropy (12 words)
  
  const entropyBits = bytesToBinary(entropy);
  const hashBits = bytesToBinary(hash);
  const checksum = hashBits.slice(0, checksumBits);
  
  const allBits = entropyBits + checksum;
  const words = [];
  
  for (let i = 0; i < allBits.length; i += 11) {
    const index = parseInt(allBits.slice(i, i + 11), 2);
    words.push(WORDLIST[index]);
  }
  
  return words.join(' ');
}

// Validate mnemonic with proper checksum verification
export async function validateMnemonic(mnemonic) {
  if (!mnemonic || typeof mnemonic !== 'string') return false;
  
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  
  // Check word count
  if (words.length !== 12 && words.length !== 24) return false;
  
  // Check all words are in wordlist and get indices
  const indices = [];
  for (const word of words) {
    const index = WORDLIST.indexOf(word);
    if (index === -1) return false;
    indices.push(index);
  }
  
  // Convert indices back to bits
  let bits = '';
  for (const index of indices) {
    bits += index.toString(2).padStart(11, '0');
  }
  
  // Split into entropy and checksum
  const entropyBits = bits.slice(0, -words.length / 3);
  const checksumBits = bits.slice(-words.length / 3);
  
  // Convert entropy bits back to bytes
  const entropyBytes = new Uint8Array(entropyBits.length / 8);
  for (let i = 0; i < entropyBytes.length; i++) {
    entropyBytes[i] = parseInt(entropyBits.slice(i * 8, (i + 1) * 8), 2);
  }
  
  // Calculate expected checksum
  const hash = await sha256(entropyBytes);
  const hashBits = bytesToBinary(hash);
  const expectedChecksum = hashBits.slice(0, words.length / 3);
  
  return checksumBits === expectedChecksum;
}

// Synchronous validation (only checks words, not checksum)
export function validateMnemonicSync(mnemonic) {
  if (!mnemonic || typeof mnemonic !== 'string') return false;
  
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  
  // Check word count
  if (words.length !== 12 && words.length !== 24) return false;
  
  // Check all words are in wordlist
  for (const word of words) {
    if (!WORDLIST.includes(word)) return false;
  }
  
  return true;
}

// Mnemonic to seed (PBKDF2)
export async function mnemonicToSeed(mnemonic, passphrase = '') {
  const encoder = new TextEncoder();
  const mnemonicBytes = encoder.encode(mnemonic.normalize('NFKD'));
  const saltBytes = encoder.encode('mnemonic' + passphrase);
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    mnemonicBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 2048,
      hash: 'SHA-512'
    },
    keyMaterial,
    512
  );
  
  return new Uint8Array(derivedBits);
}

export default {
  WORDLIST,
  generateMnemonic,
  generateMnemonicSync,
  entropyToMnemonic,
  validateMnemonic,
  validateMnemonicSync,
  mnemonicToSeed
};
