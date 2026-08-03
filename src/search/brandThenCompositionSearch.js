import { searchByBrand } from "./brandSearch.js";
import { searchByComposition } from "./compositionSearch.js";

/**
 * Run a Brand search first. If no matches (or weak matches), fall back to Composition search.
 * @param {string} query
 */
export function searchMedicinePriority(query) {
  // 1. Try Brand Search
  const brandResult = searchByBrand(query);
  
  // If we have strong brand matches (e.g., > 80 score), return them immediately.
  // We check if highestScore is reasonably high to consider it a hit, rather than a coincidental mismatch.
  if (brandResult.highestScore >= 80) {
    return {
      status: brandResult.status,
      matches: brandResult.matches.slice(0, 9)
    };
  }

  // 2. Fall back to Composition Search
  const compResult = searchByComposition(query);
  
  // If composition finds something, return it.
  if (compResult.status !== "no_match") {
    return compResult;
  }
  
  // 3. If neither found anything solid, we can return the weak brand results (if any) or just no_match.
  if (brandResult.matches.length > 0) {
    return {
      status: brandResult.status,
      matches: brandResult.matches.slice(0, 9)
    };
  }
  
  return { status: "no_match", matches: [] };
}
