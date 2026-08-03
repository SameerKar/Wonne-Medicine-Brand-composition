import { extract, WRatio } from "fuzzball";
import { medicineDb } from "../data/medicines.js";

// ==========================================
// Omni-Indexing Logic
// ==========================================
// This maps a clean search string directly to a LIST of full medicine objects.
const searchMapping = {};

function buildOmniIndex() {
  for (const item of medicineDb) {
    const brand = item["Brand Name"];
    const comp = item["Composition"];

    // 1. Index the Brand Name
    if (brand && brand.toLowerCase() !== "null") {
      const bKey = brand.toLowerCase().trim();
      if (!searchMapping[bKey]) {
        searchMapping[bKey] = [];
      }
      searchMapping[bKey].push(item);
    }

    // 2. Index the Composition (filtering out the 'Not available' entries)
    if (comp && !comp.toLowerCase().includes("not available")) {
      const cKey = comp.toLowerCase().trim();
      if (!searchMapping[cKey]) {
        searchMapping[cKey] = [];
      }
      searchMapping[cKey].push(item);
    }
  }
}

// Build the index once, at module load time (cold start only).
buildOmniIndex();

const searchKeys = Object.keys(searchMapping);

console.log(`System Ready: Mapped ${searchKeys.length} unique searchable terms.`);

/**
 * Run a fuzzy lookup against the Omni-Index (brand name OR composition).
 * @param {string} query
 * @returns {{ status: "no_match" | "exact_match" | "multiple_options", matches: object[] }}
 */
export function searchMedicine(query) {
  const cleanQuery = query.toLowerCase().trim();

  // Grab the top 5 closest matches (Brand OR Composition)
  const results = extract(cleanQuery, searchKeys, {
    scorer: WRatio,
    limit: 5,
  });

  const finalMatches = {}; // Using Sno as key to prevent duplicates
  let highestScore = 0;

  if (results.length > 0) {
    highestScore = results[0][1];
  }

  // Process all matches scoring over 60%
  for (const [matchStr, score] of results) {
    if (score >= 60.0) {
      const associatedItems = searchMapping[matchStr];

      for (const item of associatedItems) {
        const sno = item["Sno"];

        // Prevent adding the exact same medicine twice if the query matched
        // both its brand and composition slightly.
        if (!(sno in finalMatches)) {
          const resultItem = { ...item };
          resultItem["matched_via"] = matchStr;
          resultItem["confidence"] = Math.round(score * 100) / 100;
          finalMatches[sno] = resultItem;
        }
      }
    }
  }

  const matchesList = Object.values(finalMatches).sort(
    (a, b) => b.confidence - a.confidence
  );

  if (matchesList.length === 0) {
    return { status: "no_match", matches: [] };
  }

  const status = highestScore >= 85.0 ? "exact_match" : "multiple_options";
  return { status, matches: matchesList };
}
