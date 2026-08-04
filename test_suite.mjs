/**
 * Test Suite for Wonne Medicine Search Pipeline
 * 
 * Tests the searchMedicine() function directly (no server needed).
 * Run with: node test_suite.mjs
 * 
 * Covers:
 *   - Transcript failure cases (must now pass)
 *   - Phonetic garble cases (d/th, b/v, s/z)
 *   - Regression cases (must still work)
 *   - False positive guards (must NOT match wrong brands)
 */

import { searchMedicine } from "./src/search/omniIndex.js";

// ─────────────────────────────────────────────────────────────
// TEST DEFINITIONS
// ─────────────────────────────────────────────────────────────
const tests = [
  // ── Transcript failures (must now pass) ────────────────────
  {
    id: 1,
    category: "Transcript Fix",
    query: "Zozith 500",
    expectMatch: "Zozith",
    expectNotNoMatch: true,
    description: "Exact brand with number — was failing due to number asymmetry"
  },
  {
    id: 2,
    category: "Phonetic (d/th)",
    query: "Zozid500",
    expectMatch: "Zozith",
    expectNotNoMatch: true,
    description: "d/th confusion + no space — STT garble"
  },
  {
    id: 3,
    category: "Phonetic (d/th)",
    query: "Zozid 500",
    expectMatch: "Zozith",
    expectNotNoMatch: true,
    description: "d/th confusion with space"
  },
  {
    id: 4,
    category: "Heavy STT Garble",
    query: "Zo-Zozaeth 500",
    expectMatch: "Zozith",
    expectNotNoMatch: true,
    description: "Heavy garble from transcript — Zo-Zozaeth"
  },
  {
    id: 5,
    category: "Universal: Space",
    query: "NIBO TRAX",
    expectMatch: "Nivotrax",
    expectNotNoMatch: true,
    description: "b/v confusion + space issue"
  },
  {
    id: 6,
    category: "Vowel Swap",
    query: "CEFEVAL",
    expectMatch: "Cefaval",
    rejectMatch: "Kelorite",
    expectNotNoMatch: true,
    description: "Must match Cefaval, NOT Kelorite (false positive)"
  },
  {
    id: 7,
    category: "Transposition",
    query: "Losepul Plus",
    expectMatch: "Lospule",
    expectNotNoMatch: true,
    description: "Letter transposition + 'plus' preservation"
  },
  {
    id: 8,
    category: "Heavy STT Garble",
    query: "Tableton 0.5",
    expectMatch: "Tebulon",
    expectNotNoMatch: true,
    description: "Heavy STT garble of Tebulon 0.5"
  },
  
  // ── Phonetic garble cases (b/v, s/z) ───────────────────────
  {
    id: 9,
    category: "Phonetic (b/v)",
    query: "Nibotrax",
    expectMatch: "Nivotrax",
    expectNotNoMatch: true,
    description: "b/v confusion without space"
  },

  // ── Regression cases (must still work) ─────────────────────
  {
    id: 10,
    category: "Regression",
    query: "NIVOTRAX",
    expectMatch: "Nivotrax",
    expectNotNoMatch: true,
    description: "Already working — must not regress"
  },
  {
    id: 11,
    category: "Regression",
    query: "Fexival O",
    expectMatch: "Fexival O",
    expectNotNoMatch: true,
    description: "Already working — multi-word brand with letter suffix"
  },
  {
    id: 12,
    category: "Regression (Comp)",
    query: "Azithromycin",
    expectNotNoMatch: true,
    description: "Composition match — should still find Zozith via composition"
  },
  {
    id: 13,
    category: "Regression",
    query: "Polixil B",
    expectMatch: "Polixil B",
    expectNotNoMatch: true,
    description: "Already working — brand with letter suffix"
  },
  {
    id: 14,
    category: "Regression",
    query: "Coxitor 90",
    expectMatch: "Coxitor",
    expectNotNoMatch: true,
    description: "Already working — brand with number"
  },

  // ── False positive guards ──────────────────────────────────
  {
    id: 15,
    category: "False Positive Guard",
    query: "Seval",
    expectNotNoMatch: true,
    description: "Should fall back to composition search"
  },

  // ── Pharma prefix family ───────────────────────────────────
  {
    id: 16,
    category: "Prefix Family",
    query: "Fexival",
    expectMatch: "Fexival",
    expectNotNoMatch: true,
    description: "Bare brand name should match all Fexival variants"
  },
  {
    id: 17,
    category: "Prefix Family",
    query: "Moxival",
    expectMatch: "Moxival",
    expectNotNoMatch: true,
    description: "Bare brand name should match all Moxival variants"
  },

  // ── Short query ────────────────────────────────────────────
  {
    id: 18,
    category: "Short Query",
    query: "Poly",
    expectNotNoMatch: true,
    description: "Very short query — should match something via brand or comp"
  },
];

// ─────────────────────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────────────────────
function runTests() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  WONNE MEDICINE SEARCH — TEST SUITE");
  console.log("═══════════════════════════════════════════════════════\n");

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const test of tests) {
    const result = searchMedicine(test.query);
    const topMatch = result.matches.length > 0 ? result.matches[0] : null;
    const topBrand = topMatch ? topMatch["Brand Name"] : "(none)";
    const topScore = topMatch ? topMatch.confidence : 0;
    const allBrands = result.matches.map(m => m["Brand Name"]).join(", ");

    let pass = true;
    let reason = "";

    // Check: status should not be "no_match"
    if (test.expectNotNoMatch && result.status === "no_match") {
      pass = false;
      reason = `Expected a match but got no_match`;
    }

    // Check: top match should contain expected brand substring
    if (pass && test.expectMatch) {
      const matchFound = result.matches.some(m =>
        (m["Brand Name"] || "").toLowerCase().includes(test.expectMatch.toLowerCase())
      );
      if (!matchFound) {
        pass = false;
        reason = `Expected "${test.expectMatch}" in matches but got: ${allBrands || "(none)"}`;
      }
    }

    // Check: must NOT contain rejected brand
    if (pass && test.rejectMatch) {
      const rejectFound = result.matches.some(m =>
        (m["Brand Name"] || "").toLowerCase().includes(test.rejectMatch.toLowerCase())
      );
      if (rejectFound) {
        pass = false;
        reason = `Found rejected brand "${test.rejectMatch}" in matches`;
      }
    }

    if (pass) {
      passed++;
      console.log(`  ✅ #${test.id} [${test.category}] "${test.query}"`);
      console.log(`     → ${result.status} | Top: ${topBrand} (${topScore}%) | ${test.description}`);
    } else {
      failed++;
      console.log(`  ❌ #${test.id} [${test.category}] "${test.query}"`);
      console.log(`     → ${result.status} | Top: ${topBrand} (${topScore}%) | REASON: ${reason}`);
      failures.push({ id: test.id, query: test.query, reason, result });
    }
    console.log("");
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
  console.log("═══════════════════════════════════════════════════════");

  if (failures.length > 0) {
    console.log("\n  FAILURES DETAIL:");
    for (const f of failures) {
      console.log(`\n  ❌ #${f.id}: "${f.query}"`);
      console.log(`     Reason: ${f.reason}`);
      console.log(`     Status: ${f.result.status}`);
      console.log(`     Matches: ${f.result.matches.map(m => `${m["Brand Name"]} (${m.confidence}%, ${m.matched_via})`).join(" | ") || "(none)"}`);
    }
  }

  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
