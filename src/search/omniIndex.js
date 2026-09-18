import { token_set_ratio, partial_ratio, token_sort_ratio, ratio, extract } from "fuzzball";
import { medicineDb } from "../data/medicines.js";

// ==========================================
// UNIFIED BRAND-FIRST + COMPOSITION FALLBACK
// ==========================================
// Part A: Universal algorithmic fixes
// Part B: Medicine/pharma-specific fixes

// ─────────────────────────────────────────────────────────────
// INDEX STRUCTURES
// ─────────────────────────────────────────────────────────────
const brandMapping = {};              // raw lowercase brand → [items]
const normalizedBrandMapping = {};    // A3: scrubbed brand → [items]
const compMapping = {};               // composition key → [items]

// ─────────────────────────────────────────────────────────────
// B1: BRAND ALIASES — Known STT garbles from real transcripts
// Fast-path correction applied BEFORE fuzzy scoring
// ─────────────────────────────────────────────────────────────
const BRAND_ALIASES = {
  "zozid":      "zozith",
  "zosid":      "zozith",
  "zozeth":     "zozith",
  "zozaeth":    "zozith",
  "zo-zozaeth": "zozith",
  "zozozaeth":  "zozith",
  "zo-zozeth":  "zozith",
  "zozozeth":   "zozith",
  "zo-zozid":   "zozith",
  "nibotrax":   "nivotrax",
  "nibotraks":  "nivotrax",
  "losepul":    "lospule",
  "losepule":   "lospule",
  "tableton":   "tebulon",
  "tebulan":    "tebulon",
  "cefeval":    "cefaval",
  "cefavl":    "cefaval",
};

// COMPOSITION-SPECIFIC ALIASES
const COMP_ALIASES = {
  "ceftriaxone": ["safe tree exon", "safetria exon", "safetria-exon", "pre-exon", "seftriaxon", "septriaxone"],
  "cefixime":    ["sefixime", "sefixim"],
  "tinidazole":  ["tinineb", "tinidazol"],
  "simethicone": ["symthicon", "simeticone"],
  "doxofylline": ["endoxifiline"],
  "teicoplanin": ["tykoplanin"]
};

// ─────────────────────────────────────────────────────────────
// PHONETIC NORMALIZERS & SCRUBBERS
// ─────────────────────────────────────────────────────────────
function applySttAliases(str) {
  let normalizedStr = str.toLowerCase();
  for (const [canonical, mangledList] of Object.entries(COMP_ALIASES)) {
    for (const mangled of mangledList) {
      if (normalizedStr.includes(mangled)) {
        normalizedStr = normalizedStr.replace(mangled, canonical);
      }
    }
  }
  return normalizedStr;
}

function phoneticNormalize(str) {
  let normalizedStr = applySttAliases(str);

  return normalizedStr
    .replace(/\bsi([aeiou])/g, "ci$1")
    .replace(/\bsy([mn])/g, "si$1")
    .replace(/\bsy([aeiou])/g, "cy$1")
    .replace(/ph/g, "f")
    .replace(/ks/g, "x")
    .replace(/sin\b/g, "cin")
    .replace(/rin\b/g, "rine")
    .replace(/quin\b/g, "quine")
    .replace(/([^l])ilin\b/g, "$1illin")
    .replace(/([^l])alin\b/g, "$1allin")
    .replace(/prazol\b/g, "prazole")
    .replace(/([^a-z])azol\b/g, "$1azole")
    .replace(/pin\b/g, "pine");
}

// Original scrubNoise — used for composition matching (strips "plus", "lb", etc.)
function scrubNoise(inputStr) {
  return inputStr
    .toLowerCase()
    .replace(/[^\w\s\+]/g, " ") // Strip punctuation to avoid Fuzzball tokenization errors (keep spaces and +)
    .replace(/[0-9]+(\.[0-9]+)?/g, "") // Strip numbers FIRST so attached words like "trihydrate250" separate
    .replace(/\b(mg|ml|gm|mcg|iu|spores|tablet|capsule|syrup|drop|plus|injection|softgel|sr|er|xr|dt|lb|ip|usp|bp|hcl|hbr|sulfate|sulphate|trihydrate|dispersible|each|contains)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// B3: Brand-aware scrubNoise — preserves pharma modifiers that distinguish products
function brandScrubNoise(inputStr) {
  return inputStr
    .toLowerCase()
    // Strip units and dosage forms
    .replace(/\b(mg|ml|gm|mcg|iu|spores|tablet|capsule|syrup|drop|injection|softgel|ip|usp|bp|hcl|hbr)\b/gi, "")
    // Strip numbers
    .replace(/[0-9]+(\.[0-9]+)?/g, "")
    // DO NOT strip: plus, forte, gold, duo, cv, lb, oz, sr, er, xr, dt
    // These are pharma brand modifiers that distinguish products
    .replace(/\s{2,}/g, " ")
    .trim();
}

function charOverlapRatio(a, b) {
  const setA = new Set(a.replace(/\s/g, "").split(""));
  const setB = new Set(b.replace(/\s/g, "").split(""));
  const intersection = [...setA].filter((c) => setB.has(c)).length;
  return intersection / Math.max(setA.size, setB.size);
}

// ─────────────────────────────────────────────────────────────
// A2: Universal Name/Number Splitter
// ─────────────────────────────────────────────────────────────
function splitBrandParts(str) {
  const clean = str.toLowerCase().trim();
  const numbers = clean.match(/\d+(?:\.\d+)?/g) || [];
  const namePart = clean
    .replace(/\d+(?:\.\d+)?/g, "")
    .replace(/[\s\-\.]+/g, " ")
    .trim();
  return { name: namePart, numbers };
}

// A7: Extract numbers from any string
function extractNumbers(str) {
  return (str.match(/\d+(?:\.\d+)?/g) || []);
}

// ─────────────────────────────────────────────────────────────
// A4: Multi-Scorer Brand Matching
// Returns the best fuzzy score from complementary algorithms
// ─────────────────────────────────────────────────────────────
function multiBrandScore(query, brandKey) {
  return Math.max(
    ratio(query, brandKey),
    token_sort_ratio(query, brandKey)
  );
}

// ─────────────────────────────────────────────────────────────
// A6: Length-Aware Dynamic Thresholds
// Shorter strings need lower thresholds because 1-char error
// has proportionally higher impact
// ─────────────────────────────────────────────────────────────
function getBrandAcceptThreshold(queryLength) {
  if (queryLength <= 4) return 55;
  if (queryLength <= 6) return 60;
  if (queryLength <= 9) return 65;
  return 70;
}

function getBrandStrongThreshold(queryLength) {
  if (queryLength <= 6) return 73;
  if (queryLength <= 9) return 75;
  return 78;
}

function getBrandExactThreshold(queryLength) {
  if (queryLength <= 6) return 78;
  if (queryLength <= 9) return 80;
  return 82;
}

// ─────────────────────────────────────────────────────────────
// B2: Phonetic Variant Generator
// Generates alternative query forms for common Indian-English
// consonant confusions. Safe: doesn't mutate original, just
// explores alternatives during scoring.
// ─────────────────────────────────────────────────────────────
function generatePhoneticVariants(baseStr) {
  const variants = new Set([baseStr]);

  // Bidirectional + positional: replace EACH occurrence individually
  const maps = [
    ["d", "th"], ["th", "d"],
    ["b", "v"],  ["v", "b"],
    ["s", "z"],  ["z", "s"],
    // Forward: c can sound like s, x, k
    ["c", "s"],  ["c", "x"],  ["c", "k"],
    // Reverse: k/x can sound like c (Hindi speakers)
    ["k", "c"],  ["x", "c"],
    // Vowel contractions common in Hindi STT
    ["oo", "u"], ["ee", "i"], ["eu", "u"],
    // Trailing suffix fixes
    ["ks", "x"],  ["ck", "k"],
  ];

  for (const [from, to] of maps) {
    let idx = -1;
    while ((idx = baseStr.indexOf(from, idx + 1)) !== -1) {
      variants.add(baseStr.slice(0, idx) + to + baseStr.slice(idx + from.length));
    }
  }

  return Array.from(variants);
}

// ─────────────────────────────────────────────────────────────
// BUILD INDEXES
// ─────────────────────────────────────────────────────────────
function buildOmniIndexes() {
  for (const item of medicineDb) {
    const brand = item["Brand Name"];
    const comp = item["Composition"];

    // 1. Index the Brand Name (raw)
    if (brand && brand.toLowerCase() !== "null") {
      const bKey = brand.toLowerCase().trim();
      if (!brandMapping[bKey]) {
        brandMapping[bKey] = [];
      }
      brandMapping[bKey].push(item);

      // A3: Normalized index (symmetric with query processing)
      const normKey = brandScrubNoise(phoneticNormalize(brand));
      if (normKey) {
        if (!normalizedBrandMapping[normKey]) {
          normalizedBrandMapping[normKey] = [];
        }
        normalizedBrandMapping[normKey].push(item);
      }
    }

    // 2. Index the Composition
    if (comp && !comp.toLowerCase().includes("not available")) {
      const cKey = comp.toLowerCase().trim();
      if (!compMapping[cKey]) {
        compMapping[cKey] = [];
      }
      compMapping[cKey].push(item);
    }
  }
}

// Build the indexes once at load time.
buildOmniIndexes();
const brandKeys = Object.keys(brandMapping);
const normalizedBrandKeys = Object.keys(normalizedBrandMapping);

console.log(`System Ready: Mapped ${brandKeys.length} unique Brand terms, ${normalizedBrandKeys.length} normalized Brand terms, and ${Object.keys(compMapping).length} Composition terms.`);

// ─────────────────────────────────────────────────────────────
// MAIN SEARCH COORDINATOR
// ─────────────────────────────────────────────────────────────
export function searchMedicine(query) {
  const normalized  = phoneticNormalize(query);
  const cleanQuery  = scrubNoise(normalized);
  const brandCleanQuery = brandScrubNoise(normalized); // B3: preserves "plus", "lb", etc.

  // Determine the effective brand query (use brandCleanQuery for brand, cleanQuery for comp)
  const effectiveBrandQuery = brandCleanQuery || cleanQuery;
  const queryLength = effectiveBrandQuery.replace(/\s+/g, "").length;

  // Dynamic thresholds based on query length (A6)
  const ACCEPT_THRESHOLD = getBrandAcceptThreshold(queryLength);
  const STRONG_THRESHOLD = getBrandStrongThreshold(queryLength);
  const EXACT_THRESHOLD  = getBrandExactThreshold(queryLength);

  // ==============================================================
  // PASS 1: BRAND SEARCH — Multi-Tier, Multi-Scorer (A5)
  // ==============================================================
  const finalBrandMatches = {};
  let brandHighestScore = 0;

  // B1: Apply brand aliases to resolve known STT garbles
  let aliasedQuery = effectiveBrandQuery;
  // Try full query match first (handles hyphenated forms like "zo-zozaeth")
  if (BRAND_ALIASES[effectiveBrandQuery]) {
    aliasedQuery = BRAND_ALIASES[effectiveBrandQuery];
  } else {
    // Then try word-by-word replacement
    const queryWords = effectiveBrandQuery.split(/\s+/);
    for (const word of queryWords) {
      if (BRAND_ALIASES[word]) {
        aliasedQuery = aliasedQuery.replace(word, BRAND_ALIASES[word]);
      }
    }
  }

  // B2: Generate phonetic variants (d/th, b/v, s/z)
  const baseQueries = [effectiveBrandQuery];
  if (aliasedQuery !== effectiveBrandQuery) {
    baseQueries.push(aliasedQuery);
  }

  const allQueryVariants = [];
  for (const bq of baseQueries) {
    allQueryVariants.push(...generatePhoneticVariants(bq));
  }
  // Filter out variants that are too short (< 2 chars) to prevent false matches
  const uniqueVariants = [...new Set(allQueryVariants)].filter(v => v.length >= 2);

  // Helper: record a brand match
  function recordBrandMatch(item, matchStr, score) {
    // A8: Composite deduplication key
    const dedupeKey = `${item.Sno}_${(item["Brand Name"] || "").toLowerCase().trim()}`;
    if (!(dedupeKey in finalBrandMatches) || finalBrandMatches[dedupeKey].confidence < score) {
      finalBrandMatches[dedupeKey] = {
        ...item,
        matched_via: `Brand (${matchStr})`,
        confidence: Math.round(score * 100) / 100
      };
    }
    if (score > brandHighestScore) {
      brandHighestScore = score;
    }
  }

  // ── TIER 1: Exact Normalized Match ──────────────────────────
  // Check if any variant matches a normalizedBrandKey exactly
  // Minimum length guard: only match keys >= 2 chars to prevent
  // false positives on single-char brand keys (e.g. "A9" → key "a")
  for (const variant of uniqueVariants) {
    if (variant.length >= 2 && normalizedBrandMapping[variant]) {
      for (const item of normalizedBrandMapping[variant]) {
        recordBrandMatch(item, variant, 100);
      }
    }
    // Also check compact form (no spaces/hyphens)
    const compactVariant = variant.replace(/[\s\-\.]/g, "");
    if (compactVariant.length >= 2 && normalizedBrandMapping[compactVariant]) {
      for (const item of normalizedBrandMapping[compactVariant]) {
        recordBrandMatch(item, compactVariant, 100);
      }
    }
  }

  // ── TIER 2: Fuzzy Multi-Scorer Match ────────────────────────
  // Score each variant against both raw and normalized brand keys
  for (const variant of uniqueVariants) {
    const compactVariant = variant.replace(/[\s\-\.]/g, "");

    // Score against normalized brand keys (A4: multi-scorer)
    for (const normKey of normalizedBrandKeys) {
      const compactNormKey = normKey.replace(/[\s\-\.]/g, "");

      let score = Math.max(
        multiBrandScore(variant, normKey),
        multiBrandScore(compactVariant, compactNormKey)
      );
      if (score === 78) console.log("SCORE78 NORM:", variant, normKey);

        // B4: Prefix family boost
        const variantName = splitBrandParts(variant).name;
        const keyName = splitBrandParts(normKey).name;
        if (variantName.length >= 3 && keyName.length >= 3) {
          if (keyName.startsWith(variantName) || variantName.startsWith(keyName)) {
            score = Math.max(score, 85);
          }
        }

        if (score >= ACCEPT_THRESHOLD) {
          // charOverlap guard for borderline scores
          if (score < STRONG_THRESHOLD && charOverlapRatio(variant, normKey) < 0.50) {
            continue;
          }
          for (const item of normalizedBrandMapping[normKey]) {
            recordBrandMatch(item, normKey, score);
          }
        }
      }

      // Also score against raw brand keys for direct matches
      for (const rawKey of brandKeys) {
        const compactRawKey = rawKey.replace(/[\s\-\.]/g, "");

        let score = Math.max(
          multiBrandScore(variant, rawKey),
          multiBrandScore(compactVariant, compactRawKey)
        );
        if (score === 78) console.log("SCORE78 RAW:", variant, rawKey);

        // B4: Prefix family boost
        const variantName = splitBrandParts(variant).name;
        const keyName = splitBrandParts(rawKey).name;
        if (variantName.length >= 3 && keyName.length >= 3) {
          if (keyName.startsWith(variantName) || variantName.startsWith(keyName)) {
            score = Math.max(score, 85);
          }
        }

        if (score >= ACCEPT_THRESHOLD) {
          if (score < STRONG_THRESHOLD && charOverlapRatio(variant, rawKey) < 0.50) {
            continue;
          }
          for (const item of brandMapping[rawKey]) {
            recordBrandMatch(item, rawKey, score);
          }
        }
      }
    }

  // ── A7: Dosage Number Boost ─────────────────────────────────
  // If user said "Zozith 500", boost variants with matching number
  const queryNums = extractNumbers(query);
  if (queryNums.length > 0) {
    for (const dedupeKey of Object.keys(finalBrandMatches)) {
      const m = finalBrandMatches[dedupeKey];
      const brandNums = extractNumbers(m["Brand Name"] || "");
      if (queryNums.some(qn => brandNums.includes(qn))) {
        m.confidence = Math.min(100, m.confidence + 10);
        if (m.confidence > brandHighestScore) {
          brandHighestScore = m.confidence;
        }
      }
    }
  }

  // ── Collect and sort brand matches ──────────────────────────
  const brandMatchesList = Object.values(finalBrandMatches).sort((a, b) => b.confidence - a.confidence);

  let brandStatus = "multiple_options";
  if (brandHighestScore >= STRONG_THRESHOLD && brandMatchesList.length > 0) {
    const topScorers = brandMatchesList.filter(m => m.confidence >= EXACT_THRESHOLD);
    if (topScorers.length > 0) {
      const topBrandNames = topScorers.map(m => splitBrandParts(m["Brand Name"]).name);
      const uniqueTopNames = new Set(topBrandNames);
      if (uniqueTopNames.size === 1) {
        brandStatus = topScorers.length === 1 ? "exact_match" : "multiple_exact_matches";
      }
    }
  }

  // If we found EXACT brand matches, return them immediately to save CPU
  if (brandHighestScore >= EXACT_THRESHOLD && brandMatchesList.length > 0) {
    return { status: brandStatus, matches: brandMatchesList.slice(0, 15) };
  }

  // ==============================================================
  // PASS 2: COMPOSITION SEARCH FALLBACK (The 4-Layer Voice Engine)
  // Fix: Do NOT use phoneticNormalize for composition search!
  // ==============================================================
  const compCleanQuery = scrubNoise(applySttAliases(query));  // A1: Scrub query specifically for Composition matching
  const compCleanQueryCompact = compCleanQuery.replace(/\s+/g, "");
  const isSingleToken = compCleanQuery.split(/\s+/).filter(Boolean).length === 1;

  const finalCompMatches = [];
  let compHighestScore = 0;

  for (const item of medicineDb) {
    const rawComp = (item["Composition"] || "").toLowerCase();
    if (!rawComp || rawComp.includes("not available")) continue;

    const cleanComp = scrubNoise(rawComp);
    const cleanCompCompact = cleanComp.replace(/\s+/g, "");

    let compScore = 0;
    if (cleanCompCompact.includes(compCleanQueryCompact)) {
      compScore = 100;
    } else {
      let fullScore = Math.max(
        token_set_ratio(compCleanQuery, cleanComp),
        token_set_ratio(compCleanQueryCompact, cleanCompCompact)
      );

      if (isSingleToken) {
        const partial = partial_ratio(compCleanQuery, cleanComp);
        fullScore = Math.max(fullScore, partial);
      }

      let maxSaltScore = 0;
      const salts = cleanComp.split('+').map(s => s.trim());
      for (const salt of salts) {
        let saltScore = Math.max(
          token_set_ratio(compCleanQuery, salt),
          token_set_ratio(compCleanQueryCompact, salt.replace(/\s+/g, ""))
        );
        if (isSingleToken) {
          saltScore = Math.max(saltScore, partial_ratio(compCleanQuery, salt));
        }
        if (saltScore > maxSaltScore) maxSaltScore = saltScore;
      }

      compScore = fullScore;
      if (maxSaltScore < 80) {
        compScore = maxSaltScore;
      }
    }

    const saltCount = rawComp.split(/\+/).length;
    if (saltCount > 2) {
      compScore = Math.min(compScore, 88);
    }

    if (compScore >= 80.0) {
      if (compScore < 86) {
        let maxOverlap = 0;
        const salts = cleanComp.split('+').map(s => s.trim());
        for (const salt of salts) {
          maxOverlap = Math.max(maxOverlap, charOverlapRatio(compCleanQuery, salt));
        }
        if (maxOverlap < 0.55) {
          continue;
        }
      }

      finalCompMatches.push({
        ...item,
        matched_via: "Composition",
        confidence: compScore,
      });

      if (compScore > compHighestScore) {
        compHighestScore = compScore;
      }
    }
  }

  finalCompMatches.sort((a, b) => b.confidence - a.confidence);

  let compStatus = "multiple_options";
  if (compHighestScore >= 85.0) {
    const topScorers = finalCompMatches.filter(m => m.confidence === compHighestScore);
    compStatus = topScorers.length === 1 ? "exact_match" : "multiple_exact_matches";
  }

  // ==============================================================
  // DECISION MATRIX (If neither was an EXACT match initially)
  // ==============================================================
  // 1. If Composition had a very strong match (> brand), Composition wins
  if (compHighestScore >= 85.0 && compHighestScore > brandHighestScore) {
    return { status: compStatus, matches: finalCompMatches.slice(0, 15) };
  }
  // 2. Otherwise if Brand passed acceptance, Brand wins
  if (brandHighestScore >= ACCEPT_THRESHOLD && brandHighestScore >= compHighestScore) {
    return { status: brandStatus, matches: brandMatchesList.slice(0, 15) };
  }
  // 3. Otherwise if Composition passed acceptance, Composition wins
  if (compHighestScore >= 80.0) {
    return { status: compStatus, matches: finalCompMatches.slice(0, 15) };
  }

  return { status: "no_match", matches: [] };
}
