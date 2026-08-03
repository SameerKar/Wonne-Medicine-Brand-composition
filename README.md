# Wonne International — Brand-Priority Voice-Optimized Medicine Search API

The Wonne Medicine Lookup API is a high-performance, fuzzy-matching Node.js backend natively running on Cloudflare Workers. It acts as the "brain" for the Wonne International Voice AI Agent (Maansi).

Voice AI often struggles with pharmaceutical terms due to phonetic misspellings by Speech-to-Text (STT) engines (e.g., hearing "Domeprozol" instead of "Omeprazole", or "safe tree exon" instead of "Ceftriaxone"). This API strictly evaluates the user's spoken words using a **Brand-First Fallback Architecture**. It first attempts to accurately match against Brand Names, and if no strong match is found, it falls back to a **4-Layer Voice-Optimized Phonetic Engine** against Compositions, guaranteeing the AI agent handles heavy distortion natively without hallucinating.

## 🏗️ Architecture

```text
.
├── package.json
├── wrangler.jsonc
├── WonneAgentPrompt.md           # Maansi Agent System Prompt & Guidelines
└── src/
    ├── index.js                  # Express app + Worker entry point
    ├── data/
    │   └── medicines.js          # Shared medicine database
    └── search/
        └── omniIndex.js          # Unified Brand-First & Composition Fallback Search Engine
```

The API now runs everything unified from **`omniIndex.js`**. Upon startup, it builds two independent indexes: `brandMapping` and `compMapping`. 

```text
Raw Spoken Input (e.g., "Clinic D", "Rabaval PF", or "safe tree exon")
       │
       ├──► 1. Brand Index Strict Match (token_sort_ratio)
       │       - Matches against full brand names directly. 
       │       - High score (≥ 80) returned immediately, bypassing composition.
       │       - Fixes false positives (e.g. "Clinic D" falsely matching "Nervabin D").
       │
       ▼  (If Brand Match Fails - Score < 80)
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
4. Multi-Form Fuzzy Scoring (fuzzball token_set_ratio)
   - checks standard spaced forms against the Composition Index.
   - partial_ratio catches terminal vowel drops on single words.
       │
       ▼
5. Character Overlap Gate (Anti-False-Positive Filter)
   - If composition score is borderline (80-85), it must share ≥ 55% of unique characters.
       │
       ▼
   Status Output → Directly maps to Agent Matrix
```

## 📊 Understanding Confidence Scores

The `confidence` score (0 to 100) dictates how the voice agent responds:
- **100**: Perfect identical match.
- **85 - 99**: Highly confident match (minor STT misspelling). Triggers `exact_match` or `multiple_exact_matches`.
- **80 - 84**: Borderline match. The spelling is heavily distorted, but mathematically plausible. Triggers `multiple_options` (Gate C) where the agent asks the user to clarify.
- **< 80**: Ignored.

*Note: In `omniIndex.js`, if multiple **different** Brand Names score above 85 (e.g., Rabaval A vs Rabaval D), the API deliberately downgrades the status to `multiple_options` to prevent the agent from assuming it's exactly what the user wanted.*

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
