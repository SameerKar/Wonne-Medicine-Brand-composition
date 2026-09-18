# Wonne International — Omni-Search Medicine API

The Wonne Medicine Lookup API is a high-performance, fuzzy-matching Node.js backend natively running on Cloudflare Workers. It acts as the "brain" for the Wonne International Voice AI Agent (Maansi).

Voice AI often struggles with pharmaceutical terms due to phonetic misspellings by Speech-to-Text (STT) engines (e.g., hearing "Domeprozol" instead of "Omeprazole"). This API strictly evaluates the user's spoken words using a unified **Omni-Search Engine** (`omniIndex.js`). It executes a **Brand Pass** and a **Composition Pass** in parallel, running the results through a final **Decision Matrix** to guarantee the AI agent handles heavy distortion natively without hallucinating.

---

## 🏗️ Architecture & Internal Mechanics

The entire matching logic is centralized within `src/search/omniIndex.js`. 

### The Core Execution Flow

```text
User Input: "Silymarin" or "safe tree exon"
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[ PASS 1: BRAND SEARCH ]               [ PASS 2: COMPOSITION SEARCH ]
       │                                         │
       ├─► 1. Basic cleaning                     ├─► 1. STT Alias Expansion 
       │      (removes mg, ml)                   │      ("safe tree exon" -> "ceftriaxone")
       │                                         │
       ├─► 2. Phonetic Normalization             ├─► 2. Noise Scrubber (scrubNoise)
       │      (ph->f, c->k, z->s)                │      Removes mg, ml, weights, and useless words.
       │                                         │      (NO phonetic distortion to protect chemicals)
       ├─► 3. Fuzzball Scoring                   │
       │      (ratio & token_sort_ratio)         ├─► 3. Compact Safety Net
       │                                         │      Direct string matching without spaces 
       │                                         │      (e.g., "sodiummonofluorophosphate")
       │                                         │
       │                                         ├─► 4. Salt-Level Fuzzball Scoring
       │                                         │      Splits DB compositions by "+"
       │                                         │      Scores query against EACH salt independently.
       │                                         │
       │                                         ├─► 5. Anti-Hallucination Gate
       │                                         │      Prevents disconnected words (like "Potassium" 
       │                                         │      and "Nitrate") from combining across salts.
       │                                         │
       │                                         ├─► 6. Char Overlap Filter (Score < 86)
       │                                         │
       ▼                                         ▼
[ Brand Results ]                         [ Composition Results ]
       │                                         │
       └───────────────────┬─────────────────────┘
                           ▼
                 [ DECISION MATRIX ]
       Compares Brand Confidence vs Composition Confidence.
       Prioritizes 100% exact composition matches over fuzzy brand matches.
                           │
                           ▼
                     [ API OUTPUT ]
                 (Status & Matches JSON)
```

### Deep Dive: Pass 2 (Composition Search)

The Composition Search is the most complex part of the engine, designed to handle chemical names that are often mangled by voice agents, without accidentally hallucinating matches.

#### 1. The Compact Safety Net
Chemical names in the database often have inconsistent spacing (e.g., `Sodium monofluoro phosphate`). The engine strips all spaces from both the query and the database to do a literal `includes()` check, instantly catching hidden exact matches.

```javascript
// A1: Scrub query and remove all spaces
const compCleanQuery = scrubNoise(query);
const compCleanQueryCompact = compCleanQuery.replace(/\s+/g, "");

// Check inclusion directly for tricky spaceless chemical names
const cleanCompCompact = cleanComp.replace(/\s+/g, "");

let compScore = 0;
if (cleanCompCompact.includes(compCleanQueryCompact)) {
  compScore = 100; // Instant exact match!
} else {
  // Proceed to fuzzy scoring...
}
```

#### 2. Salt-Level Validation
Standard fuzzy matching treats words independently of order. A query for "Potassium Nitrate" could falsely match a medicine containing "Potassium Iodide + Phenylmercuric Nitrate" because both words exist in the text. 

The engine fixes this by calculating the `token_set_ratio` against the full string **AND** against each individual chemical salt (split by `+`). If the score against the individual salts is low (< 80), the engine identifies it as a "Cross-Salt Hallucination" and severely penalizes the score.

```javascript
// Base score against the full composition string
let fullScore = Math.max(
  token_set_ratio(compCleanQuery, cleanComp),
  token_set_ratio(compCleanQueryCompact, cleanCompCompact)
);

// Validate via individual salts to prevent cross-salt hallucination
let maxSaltScore = 0;
const salts = cleanComp.split('+').map(s => s.trim());

for (const salt of salts) {
  let saltScore = Math.max(
    token_set_ratio(compCleanQuery, salt),
    token_set_ratio(compCleanQueryCompact, salt.replace(/\s+/g, ""))
  );
  if (saltScore > maxSaltScore) maxSaltScore = saltScore;
}

compScore = fullScore;
if (maxSaltScore < 80) {
  // No single salt strongly matched the query.
  // The fullScore is a hallucination!
  compScore = maxSaltScore; 
}
```

#### 3. The Decision Matrix (Brand vs Composition)
At the end of the search, the engine compares the highest confidence found in the Brand search versus the Composition search. It prevents weak fuzzy Brand matches from burying strong Composition matches.

```javascript
// If Composition had a very strong match (> brand), Composition wins
if (compHighestScore >= 85.0 && compHighestScore > brandHighestScore) {
  return { status: compStatus, matches: finalCompMatches };
}

// Otherwise, the highest score wins
if (brandHighestScore >= compHighestScore) {
  return { status: brandStatus, matches: finalBrandMatches };
} else {
  return { status: compStatus, matches: finalCompMatches };
}
```

---

## 📊 Understanding Confidence Scores

The `confidence` score (0 to 100) dictates how the voice agent responds:

- **100**: Perfect identical match or resolved alias.
- **85 - 99**: Highly confident match (minor STT misspelling). Triggers `exact_match` or `multiple_exact_matches`.
- **80 - 84**: Borderline match. The spelling is heavily distorted, but mathematically plausible. Triggers `multiple_options` (Gate C) where the agent asks the user to clarify.
- **< 80**: Ignored.

*Note: If multiple **different** Brand Names score above 85 (e.g., Rabaval A vs Rabaval D), the API deliberately downgrades the status to `multiple_options` to prevent the agent from assuming it's exactly what the user wanted.*

---

## 🤖 AI Agent Integration (The 4-Gate Routing Matrix)

The API returns a highly specific `status` string that directly controls the Maansi Voice Agent's conversational flow.

| API Status Tag | Trigger Condition | AI Agent Behavior (Maansi) |
| --- | --- | --- |
| `exact_match` | (Gate A) Score ≥ 85%, single match. | **Instant Close**: Reads Brand, Dosage, Price immediately. Asks for quantity. |
| `multiple_exact_matches`| (Gate B) Score ≥ 85%, multiple variants of same salt. | **Variant Check**: Reads Brands/Dosages (NO PRICE). Asks user which variant/mg they need. |
| `multiple_options` | (Gate C) Borderline score or different salts. | **Generic vs Brand Check**: Assumes network issue/blurry word, asks if they meant a generic or specific brand. |
| `no_match` | (Gate D) No valid score found. | **Spelling Fallback**: Admits drug isn't in catalog. 3-Strike Rule applies before escalating. |

---

## 🔄 Version History & Changelog (Latest Fixes)

The search engine was recently upgraded to fix critical issues where fuzzy brand matches were overriding valid composition matches, and strict text gates were destroying valid fuzzy composition matches.

| Feature / Logic | Before Version | Latest Version |
| :--- | :--- | :--- |
| **Pass Execution Order** | Evaluated Brand first. If Brand score > 75, returned immediately, completely skipping Composition. | **Simultaneous Execution**. Evaluates both Brand and Composition, and uses a **Decision Matrix** at the end. |
| **Fuzzy Override** | A 78% fuzzy Brand match (e.g., `Bilarin 20` for "Silymarin") would win over a 100% exact Composition match. | If Composition has a 100% score (and is stronger than the fuzzy Brand), **Composition wins**. |
| **Composition Exact Gates** | Used an `isSubset` loop that required exact string-matching of individual tokens. Failed on spaced chemical names (e.g. `monofluoro phosphate`) and phonetic aliases (e.g. `guaifenesin` vs `guaiphenesin`). | Removed the brittle `isSubset` gate completely. Valid fuzzy scores now reliably pass the threshold. |
| **Spaceless Chemical Matching** | Heavily dependent on exact Fuzzball scores which struggled with inconsistent database spacing. | Added **Compact Safety Net**. Instantly detects exact matches when spaces are removed (e.g., `sodiummonofluorophosphate`). |
| **Hallucination Prevention** | Fuzzball `token_set_ratio` allowed "Potassium Nitrate" to score 100% by combining words from "Potassium Iodide" and "Phenylmercuric Nitrate". | Added **Salt-Level Validation**. The query is verified against *each individual salt* independently, eliminating cross-salt hallucination. |
| **Anti-False-Positive Filter** | `charOverlapRatio` evaluated the query against the *entire* composition text, failing small queries. | `charOverlapRatio` is now calculated strictly against individual salts, keeping it robust without falsely rejecting short queries. |

---

## 🧪 Testing

The engine comes with a zero-dependency **67-case phonetic test suite** covering slurring, Indian accents, STT errors, syllable swaps, multi-drug combos, and short single tokens.

```bash
node scratch/test_suite.mjs
```

## 🚀 Deployment

```bash
npm install
npm run dev              # Test locally at http://localhost:8787
npm run deploy           # Deploy to Cloudflare Workers
```
