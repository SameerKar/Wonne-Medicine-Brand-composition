import { extract, WRatio } from "fuzzball";
import { medicineDb } from "../data/medicines.js";

// ==========================================
// Brand-Only Indexing Logic
// ==========================================
// This maps a clean search string directly to a LIST of full medicine objects.
const searchMapping = {};

function buildBrandIndex() {
  for (const item of medicineDb) {
    const brand = item["Brand Name"];

    if (brand && brand.toLowerCase() !== "null") {
      const bKey = brand.toLowerCase().trim();
      if (!searchMapping[bKey]) {
        searchMapping[bKey] = [];
      }
      searchMapping[bKey].push(item);
    }
  }
}

// Build the index once, at module load time.
buildBrandIndex();

const searchKeys = Object.keys(searchMapping);
console.log(`System Ready: Mapped ${searchKeys.length} unique searchable Brand terms.`);

/**
 * Run a fuzzy lookup against the Brand-Index.
 * @param {string} query
 * @returns {{ status: "no_match" | "exact_match" | "multiple_options", matches: object[], highestScore: number }}
 */
export function searchByBrand(query) {
  const cleanQuery = query.toLowerCase().trim();

  // Grab the top 5 closest matches (Brand only)
  const results = extract(cleanQuery, searchKeys, {
    scorer: WRatio,
    limit: 5,
  });

  const finalMatches = {}; // Using Sno as key to prevent duplicates
  let highestScore = 0;

  if (results.length > 0) {
    highestScore = results[0][1];
  }

  // Process all matches scoring over 75%
  for (const [matchStr, score] of results) {
    if (score >= 75.0) {
      const associatedItems = searchMapping[matchStr];

      for (const item of associatedItems) {
        const sno = item["Sno"];

        if (!(sno in finalMatches)) {
          const resultItem = { ...item };
          resultItem["matched_via"] = `Brand (${matchStr})`;
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
    return { status: "no_match", matches: [], highestScore: 0 };
  }

  const status = highestScore >= 85.0 ? "exact_match" : "multiple_options";
  return { status, matches: matchesList, highestScore };
}
