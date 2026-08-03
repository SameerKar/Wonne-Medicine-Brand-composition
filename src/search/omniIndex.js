import { token_set_ratio, partial_ratio, token_sort_ratio, extract } from "fuzzball";
import { medicineDb } from "../data/medicines.js";

// ==========================================
// UNIFIED BRAND-FIRST + COMPOSITION FALLBACK
// ==========================================

const brandMapping = {};
const compMapping = {}; // Keep for structural consistency, though we iterate DB directly for comp

function buildOmniIndexes() {
  for (const item of medicineDb) {
    const brand = item["Brand Name"];
    const comp = item["Composition"];

    // 1. Index the Brand Name
    if (brand && brand.toLowerCase() !== "null") {
      const bKey = brand.toLowerCase().trim();
      if (!brandMapping[bKey]) {
        brandMapping[bKey] = [];
      }
      brandMapping[bKey].push(item);
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

console.log(`System Ready: Mapped ${brandKeys.length} unique Brand terms and ${Object.keys(compMapping).length} Composition terms.`);

// ─────────────────────────────────────────────────────────────
// PHONETIC NORMALIZERS & SCRUBBERS (From Composition Engine)
// ─────────────────────────────────────────────────────────────
function phoneticNormalize(str) {
  const ALIASES = {
    "ceftriaxone": ["safe tree exon", "safetria exon", "safetria-exon", "pre-exon", "seftriaxon", "septriaxone"],
    "cefixime":    ["sefixime", "sefixim"],
    "tinidazole":  ["tinineb", "tinidazol"],
    "simethicone": ["symthicon", "simeticone"],
  };

  let normalizedStr = str.toLowerCase();
  for (const [canonical, mangledList] of Object.entries(ALIASES)) {
    for (const mangled of mangledList) {
      if (normalizedStr.includes(mangled)) {
        normalizedStr = normalizedStr.replace(mangled, canonical);
      }
    }
  }

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

function scrubNoise(inputStr) {
  return inputStr
    .toLowerCase()
    .replace(/\b(mg|ml|gm|mcg|iu|spores|tablet|capsule|syrup|drop|plus|injection|sr|er|xr|dt|lb|ip|usp|bp|hcl|hbr)\b/gi, "")
    .replace(/\b(hydrochloride|hydro|chloride|sulphate|sulfate|sodium|potassium|acid|cholic|oxide|nitrate|citrate|gluconate|acetate|tartrate|succinate|fumarate|maleate|monohydrate|trihydrate|dihydrate|anhydrous|anhydrous|phosphate|carbonate|bicarbonate)\b/gi, "")
    .replace(/[0-9]+(\.[0-9]+)?/g, "")
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
// MAIN SEARCH COORDINATOR
// ─────────────────────────────────────────────────────────────
export function searchMedicine(query) {
  const normalized  = phoneticNormalize(query);
  const cleanQuery  = scrubNoise(normalized);

  // ==============================================================
  // PASS 1: BRAND SEARCH (Strict `token_sort_ratio`)
  // ==============================================================
  const brandResults = extract(cleanQuery, brandKeys, {
    scorer: token_sort_ratio,
    limit: 5,
  });

  const finalBrandMatches = {};
  let brandHighestScore = brandResults.length > 0 ? brandResults[0][1] : 0;

  for (const [matchStr, score] of brandResults) {
    if (score >= 70.0) { // Accept brand scores down to 70 for heavily scrubbed inputs
      const associatedItems = brandMapping[matchStr];
      for (const item of associatedItems) {
        if (!(item.Sno in finalBrandMatches)) {
          finalBrandMatches[item.Sno] = {
            ...item,
            matched_via: `Brand (${matchStr})`,
            confidence: Math.round(score * 100) / 100
          };
        }
      }
    }
  }

  const brandMatchesList = Object.values(finalBrandMatches).sort((a, b) => b.confidence - a.confidence);

  // If we found a very strong brand match, return it and DO NOT run composition fallback
  if (brandHighestScore >= 80.0 && brandMatchesList.length > 0) {
    const topScorers = brandMatchesList.filter(m => m.confidence === brandHighestScore);
    
    // Check if the top scorers all share the EXACT same base brand name
    const uniqueTopBrands = new Set(topScorers.map(m => m["Brand Name"].toLowerCase().trim()));
    
    let status = "multiple_options"; // Default to Gate C if multiple DIFFERENT brands score 85+
    
    if (brandHighestScore >= 85.0) {
      if (uniqueTopBrands.size === 1) {
        // Only trigger Gate A / Gate B if they actually are the same brand
        status = topScorers.length === 1 ? "exact_match" : "multiple_exact_matches";
      }
    }

    return { status, matches: brandMatchesList.slice(0, 9) };
  }

  // ==============================================================
  // PASS 2: COMPOSITION SEARCH FALLBACK (The 4-Layer Voice Engine)
  // ==============================================================
  const compactQuery = cleanQuery.replace(/\s+/g, "");
  const isSingleToken = cleanQuery.split(/\s+/).filter(Boolean).length === 1;

  const finalCompMatches = [];
  let compHighestScore = 0;

  for (const item of medicineDb) {
    const rawComp = (item["Composition"] || "").toLowerCase();
    if (!rawComp || rawComp.includes("not available")) continue;

    const cleanComp   = scrubNoise(rawComp);
    const compactComp = cleanComp.replace(/\s+/g, "");

    let compScore = Math.max(
      token_set_ratio(cleanQuery,   cleanComp),
      token_set_ratio(compactQuery, cleanComp),
      token_set_ratio(cleanQuery,   compactComp)
    );

    if (isSingleToken) {
      compScore = Math.max(compScore, partial_ratio(cleanQuery, cleanComp));
      const saltCount = rawComp.split(/\+/).length;
      if (saltCount > 2) {
        compScore = Math.min(compScore, 88);
      }
    }

    if (compScore >= 80.0) {
      if (compScore < 86 && charOverlapRatio(cleanQuery, cleanComp) < 0.55) {
        continue; // Reject borderline false-positives (like Azithrocillin)
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

  if (finalCompMatches.length === 0) {
    return { status: "no_match", matches: [] };
  }

  let status = "multiple_options";
  if (compHighestScore >= 85.0) {
    const topScorers = finalCompMatches.filter(m => m.confidence === compHighestScore);
    status = topScorers.length === 1 ? "exact_match" : "multiple_exact_matches";
  }

  return { status, matches: finalCompMatches.slice(0, 9) };
}
