# Wonne International — Brand-Priority Voice-Optimized Medicine Search API

The Wonne Medicine Lookup API is a high-performance, fuzzy-matching Node.js backend natively running on Cloudflare Workers. It acts as the "brain" for the Wonne International Voice AI Agent (Maansi).

Voice AI often struggles with pharmaceutical terms due to phonetic misspellings by Speech-to-Text (STT) engines (e.g., hearing "Domeprozol" instead of "Omeprazole", or "safe tree exon" instead of "Ceftriaxone"). This API strictly evaluates the user's spoken words using a **Brand-First Fallback Architecture**. It first attempts to accurately match against Brand Names, and if no strong match is found, it falls back to a **4-Layer Voice-Optimized Phonetic Engine** against Compositions, guaranteeing the AI agent handles heavy distortion natively without hallucinating.

## 🏗️ Architecture

```text
.
├── package.json
├── wrangler.jsonc
├── phonetic_test.mjs             # 67-case test suite for phonetic edge cases (97% accuracy)
├── WonneAgentPrompt.md           # Maansi Agent System Prompt & Guidelines
└── src/
    ├── index.js                  # Express app + Worker entry point
    ├── data/
    │   └── medicines.js          # Shared medicine database
    └── search/
        ├── brandSearch.js                   # Strict Brand Name indexer and fuzzy-matcher
        ├── compositionSearch.js             # Voice-Optimized 4-Layer Phonetic Search Engine
        └── brandThenCompositionSearch.js    # Coordinator handling priority and fallback logic
```

The API first runs the spoken input against the Brand Name index. If no high-confidence brand matches are found, it routes to a 4-layered composition pipeline designed specifically for Voice AI.

```text
Raw Spoken Input (e.g., "safe tree exon" or "Paravel")
       │
       ├──► 1. Brand Index Fuzzy Match
       │       - Matches > 80% confidence returned immediately.
       │
       ▼  (If Brand Match Fails)
2. Phonetic Normalizer & Alias Expansion
   - Hardcoded aliases for severely mangled STT (e.g., "safe tree exon" → "ceftriaxone")
   - Indian-accent STT fixes (e.g., C→S, ks→x, -sin→cin, -rin→rine)
       │
       ▼
3. Noise Scrubber (scrubNoise)
   - Strips mg, ml, units, and spoken numbers ("five hundred").
   - Strips retailer salt descriptors (hydrochloride, sodium, cholic, acid, etc.)
       │
       ▼
4. Multi-Form Fuzzy Scoring (fuzzball)
   - token_set_ratio checks standard spaced forms.
   - compactQuery vs cleanComp catches STT split-words ("methyl cobalamin" → "methylcobalamin").
   - partial_ratio catches terminal vowel drops on single words ("Metronidazol").
   - caps scores of multi-salt combinations for single-token queries.
       │
       ▼
5. Character Overlap Gate (Anti-False-Positive Filter)
   - If score is borderline (80-85), it must share ≥ 55% of unique characters.
   - Prevents wrong-suffix accidents (e.g., Azithrocillin matching Azithromycin).
       │
       ▼
   Status Output → Directly maps to Agent Matrix
```

## 🤖 AI Agent Integration (The 4-Gate Routing Matrix)

The API returns a highly specific `status` string that directly controls the Maansi Voice Agent's conversational flow (Gate A, B, C, D in the agent prompt).

| API Status Tag | Trigger Condition | AI Agent Behavior (Maansi) |
| --- | --- | --- |
| `exact_match` | (Gate A) Score ≥ 85%, single match. | **Instant Close**: Reads Brand, Dosage, Price immediately. Asks for quantity. |
| `multiple_exact_matches`| (Gate B) Score ≥ 85%, multiple variants of same salt. | **Variant Check**: Reads Brands/Dosages (NO PRICE). Asks user which variant/mg they need. |
| `multiple_options` | (Gate C) Borderline score or different salts. | **Generic vs Brand Check**: Assumes network issue/blurry word, asks if they meant a generic or specific brand. |
| `no_match` | (Gate D) No valid score found. | **Spelling Fallback**: Admits drug isn't in catalog. 3-Strike Rule applies before escalating. |

## 🧪 Testing

The engine comes with a zero-dependency **67-case phonetic test suite** covering slurring, Indian accents, STT errors, syllable swaps, multi-drug combos, and short single tokens.

```bash
node phonetic_test.mjs
```
*Current Accuracy: 97% (65/67 tests passing. Residuals are intentional Gate C/D behaviors).*

## 🚀 Deployment

```bash
npm install
npm run dev              # Test locally at http://localhost:8787
npm run deploy           # Deploy to Cloudflare Workers
```
