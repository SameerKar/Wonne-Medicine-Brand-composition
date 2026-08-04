import { searchMedicine } from "./src/search/omniIndex.js";

const extendedTests = [
  // ── Exact Matches ──────────────────────────────
  { query: "Zozith 500", category: "Exact Match", expected: "Zozith" },
  { query: "Nivotrax 5", category: "Exact Match", expected: "Nivotrax" },
  
  // ── Dosage Variations ──────────────────────────
  { query: "Zozith", category: "Dosage (Missing)", expected: "Zozith" },
  { query: "Zozith 250", category: "Dosage (Exact)", expected: "Zozith 250" },
  
  // ── STT Phonetic Confusions ────────────────────
  { query: "Zozid 500", category: "Phonetic (d/th)", expected: "Zozith" },
  { query: "Nibotrax", category: "Phonetic (b/v)", expected: "Nivotrax" },
  { query: "Sefaval", category: "Phonetic (c/s)", expected: "Cefaval" },
  { query: "Tebulon", category: "Phonetic (exact name)", expected: "Tebulon" },
  
  // ── Heavy Garbling / Transpositions ────────────
  { query: "Losepul Plus", category: "Transposition", expected: "Lospule" },
  { query: "Tableton 0.5", category: "Heavy Garble", expected: "Tebulon" },
  { query: "Zo-Zozaeth 500", category: "Heavy Garble", expected: "Zozith" },
  
  // ── Spacing and Special Characters ─────────────
  { query: "NIBO TRAX", category: "Spacing", expected: "Nivotrax" },
  { query: "Fexival-O", category: "Punctuation", expected: "Fexival O" },
  { query: "Polixil B", category: "Spacing (Correct)", expected: "Polixil B" },
  
  // ── Short Queries ──────────────────────────────
  { query: "Poly", category: "Short Query", expected: "Pol" }, // Should match Polixil or Polex
  
  // ── Composition Fallback ───────────────────────
  { query: "Azithromycin", category: "Composition", expected: "Zozith" }, 
  { query: "Paracetamol", category: "Composition", expected: "Kamyton" }, 
  
  // ── No Match / Random Noise ────────────────────
  { query: "RandomNonsenseWord123", category: "Noise", expected: null },
  { query: "asdfghjkl", category: "Noise", expected: null }
];

console.log("# Extended Test Execution Results\n");
console.log("| Query | Category | Status | Top Match | Score | Via |");
console.log("|---|---|---|---|---|---|");

for (const test of extendedTests) {
  const result = searchMedicine(test.query);
  const topMatch = result.matches.length > 0 ? result.matches[0] : null;
  const status = result.status;
  
  let matchName = "(none)";
  let score = 0;
  let via = "-";
  
  if (topMatch) {
    matchName = topMatch["Brand Name"];
    score = topMatch.confidence;
    via = topMatch.matched_via;
  }
  
  let passEmoji = "❌";
  if (test.expected === null) {
    passEmoji = status === "no_match" ? "✅" : "❌";
  } else {
    if (topMatch && (matchName || "").toLowerCase().includes(test.expected.toLowerCase())) {
      passEmoji = "✅";
    }
  }
  
  console.log(`| ${passEmoji} \`${test.query}\` | ${test.category} | \`${status}\` | ${matchName} | ${score}% | ${via} |`);
}
