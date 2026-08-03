
/**
 * COMPREHENSIVE PHONETIC COMPOSITION TEST SUITE
 * Tests how a Voice AI / STT system might mispronounce pharma composition names.
 *
 * Categories Tested:
 *  1. Perfect input (baseline sanity check)
 *  2. Simple slurring / mispronunciation
 *  3. Indian-English accent phonetics
 *  4. Common STT errors (silent letters, merged words)
 *  5. Syllable swap / reversal errors
 *  6. Generic drug suffixes confused (e.g., -mycin vs -cillin)
 *  7. Multi-drug combo queries (partial + phonetic)
 *  8. Number/unit confusion
 *  9. Completely wrong phonetic ("sounds like")
 * 10. Short single-word queries (ambiguous)
 */

// Node-side polyfill to import the ES module
import { searchByComposition } from "./src/search/compositionSearch.js";

// ─────────────────────────────────────────────────────────────
// Test Case Registry
// ─────────────────────────────────────────────────────────────
const tests = [
  // ─── CATEGORY 1: Baseline / Perfect Input ───────────────────
  {
    category: "Baseline",
    input: "Azithromycin",
    expectAny: ["Azithromycin"],
    note: "Exact match – must always hit",
  },
  {
    category: "Baseline",
    input: "Amoxycillin",
    expectAny: ["Amoxycillin", "Amoxicillin"],
    note: "Common antibiotic exact spelling",
  },
  {
    category: "Baseline",
    input: "Paracetamol",
    expectAny: ["Paracetamol"],
    note: "Most common drug – must always hit",
  },
  {
    category: "Baseline",
    input: "Esomeprazole",
    expectAny: ["Esomeprazole"],
    note: "PPI baseline",
  },
  {
    category: "Baseline",
    input: "Levocetirizine",
    expectAny: ["Levocetirizine"],
    note: "Antihistamine baseline",
  },

  // ─── CATEGORY 2: Simple Slurring / Mispronunciation ─────────
  {
    category: "Slurring",
    input: "Azithromysin",                  // -mycin → -mysin
    expectAny: ["Azithromycin"],
    note: "c→s swap in -mycin suffix",
  },
  {
    category: "Slurring",
    input: "Amoxycilin",                    // missing one 'l'
    expectAny: ["Amoxycillin", "Amoxicillin"],
    note: "Double-l → single-l elision",
  },
  {
    category: "Slurring",
    input: "Paracetamoll",                  // extra l
    expectAny: ["Paracetamol"],
    note: "Extra trailing letter",
  },
  {
    category: "Slurring",
    input: "Esomiprazole",                  // e→i vowel swap
    expectAny: ["Esomeprazole"],
    note: "Vowel swap in middle syllable",
  },
  {
    category: "Slurring",
    input: "Levocetrizine",                 // missing syllable 'i'
    expectAny: ["Levocetirizine"],
    note: "Dropped inner syllable",
  },
  {
    category: "Slurring",
    input: "Clarithromysin",
    expectAny: ["Clarithromycin"],
    note: "c→s in -mycin for Clarithromycin",
  },
  {
    category: "Slurring",
    input: "Metronidazol",                  // missing terminal 'e'
    expectAny: ["Metronidazole"],
    note: "Missing terminal vowel",
  },

  // ─── CATEGORY 3: Indian-English Accent Phonetics ────────────
  {
    category: "Indian-Accent",
    input: "Amoxicilin potassium clavulanate",
    expectAny: ["Amoxycillin", "Amoxicillin", "Clavulanate"],
    note: "Amoxyclav combo – Indian shorthand",
  },
  {
    category: "Indian-Accent",
    input: "Siprofloxasin",                 // C→S, c→s
    expectAny: ["Ciprofloxacin"],
    note: "Ciprofloxacin pronounced with 'S' sound",
  },
  {
    category: "Indian-Accent",
    input: "Levofloksasin",                 // x→ks, c→s
    expectAny: ["Levofloxacin"],
    note: "Levofloxacin Indian-accent variant",
  },
  {
    category: "Indian-Accent",
    input: "Pantoprazol",
    expectAny: ["Pantoprazole"],
    note: "Missing terminal -e (very common in India)",
  },
  {
    category: "Indian-Accent",
    input: "Rabeprazol",
    expectAny: ["Rabeprazole"],
    note: "Rabeprazole without terminal e",
  },
  {
    category: "Indian-Accent",
    input: "Ondansetron",
    expectAny: ["Ondansetron"],
    note: "Exact but testing Indian context",
  },
  {
    category: "Indian-Accent",
    input: "Moxifloxasin",
    expectAny: ["Moxifloxacin"],
    note: "Moxifloxacin with -s instead of -c",
  },
  {
    category: "Indian-Accent",
    input: "Drotaverin",
    expectAny: ["Drotaverine"],
    note: "Missing terminal -e",
  },

  // ─── CATEGORY 4: STT (Speech-To-Text) Errors ────────────────
  {
    category: "STT-Errors",
    input: "azithro mycin",                 // space inserted mid-word
    expectAny: ["Azithromycin"],
    note: "STT inserts space inside drug name",
  },
  {
    category: "STT-Errors",
    input: "para cetamol",
    expectAny: ["Paracetamol"],
    note: "Para-cetamol split at common break",
  },
  {
    category: "STT-Errors",
    input: "eso meprazole",
    expectAny: ["Esomeprazole"],
    note: "Esomeprazole split",
  },
  {
    category: "STT-Errors",
    input: "levo cetirizine",
    expectAny: ["Levocetirizine"],
    note: "Levo prefix separated",
  },
  {
    category: "STT-Errors",
    input: "amoxy cillin",
    expectAny: ["Amoxycillin", "Amoxicillin"],
    note: "Amoxycillin split",
  },
  {
    category: "STT-Errors",
    input: "methylcobalamin",               // exact – STT usually gets this right
    expectAny: ["Methylcobalamin"],
    note: "Long vitamin B12 name",
  },
  {
    category: "STT-Errors",
    input: "methyl cobalamin",              // split version
    expectAny: ["Methylcobalamin"],
    note: "Methylcobalamin split by STT",
  },
  {
    category: "STT-Errors",
    input: "levetiracetam",
    expectAny: ["Levetiracetam"],
    note: "Anti-epileptic exact",
  },
  {
    category: "STT-Errors",
    input: "leve tyra setam",               // extreme STT fragmentation
    expectAny: ["Levetiracetam"],
    note: "Extreme STT fragmentation of Levetiracetam",
  },

  // ─── CATEGORY 5: Syllable Swap / Reversal ───────────────────
  {
    category: "Syllable-Swap",
    input: "Cefixime Trihydrate",
    expectAny: ["Cefixime"],
    note: "With salt suffix – should still match",
  },
  {
    category: "Syllable-Swap",
    input: "Trihydrate Cefixime",           // reversed order
    expectAny: ["Cefixime"],
    note: "Reversed word order – token_set_ratio should handle",
  },
  {
    category: "Syllable-Swap",
    input: "Clavulanate Amoxycillin",       // reversed combo
    expectAny: ["Amoxycillin", "Amoxicillin"],
    note: "Reversed combo drug order",
  },
  {
    category: "Syllable-Swap",
    input: "Potassium cefixime clavulanate",
    expectAny: ["Cefixime"],
    note: "Scrambled multi-drug with extra word",
  },

  // ─── CATEGORY 6: Suffix Confusion ───────────────────────────
  {
    category: "Suffix-Confusion",
    // "Azithrocillin" shares the "Azithro" prefix with Azithromycin.
    // The engine correctly returns multiple_options (Gate C) — Maansi
    // will use the Gate C script to ask the caller to clarify whether
    // they meant a generic name or a brand name. This is safer than
    // a hard no_match which would make the agent ask them to spell it.
    input: "Azithrocillin",
    expectAny: ["Azithromycin"],            // Gate C: returns Azithromycin as candidate — agent clarifies
    note: "Wrong suffix class – routes to Gate C (clarify), not Gate D (spell). Agent cross-check filters it.",
  },
  {
    category: "Suffix-Confusion",
    input: "Amoxymycin",                    // -cillin → -mycin
    expectAny: [],
    note: "Wrong suffix – amoxymycin doesn't exist",
  },
  {
    category: "Suffix-Confusion",
    input: "Cefiximine",                    // -xime → -ximine
    expectAny: ["Cefixime"],
    note: "Extra -ine suffix appended",
  },
  {
    category: "Suffix-Confusion",
    input: "Ondansetrone",                  // extra -e
    expectAny: ["Ondansetron"],
    note: "Extra vowel added to Ondansetron",
  },

  // ─── CATEGORY 7: Multi-Drug Combo Queries ───────────────────
  {
    category: "Combo-Query",
    input: "Ambroxol Guaiphenesin Levosalbutamol",
    expectAny: ["Ambroxol", "Guaiphenesin", "Levosalbutamol"],
    note: "Triple combo from cough syrup",
  },
  {
    category: "Combo-Query",
    input: "Levocetirizine Montelukast",
    expectAny: ["Levocetirizine", "Montelukast"],
    note: "Classic allergy combo",
  },
  {
    category: "Combo-Query",
    input: "Pantoprazole domperidone",
    expectAny: ["Pantoprazole", "Domperidone"],
    note: "PPI + prokinetic combo",
  },
  {
    category: "Combo-Query",
    input: "telmisartan metoprolol",
    expectAny: ["Telmisartan", "Metoprolol"],
    note: "BP combo – cardiac",
  },
  {
    category: "Combo-Query",
    input: "Rosuvastatin aspirin",
    expectAny: ["Rosuvastatin", "Aspirin"],
    note: "Statin + antiplatelet",
  },
  {
    category: "Combo-Query",
    input: "Pregabalin nortriptyline",
    expectAny: ["Pregabalin", "Nortriptyline"],
    note: "Neuropathic pain combo",
  },
  {
    category: "Combo-Query",
    input: "Duloxetine pregabalin",
    expectAny: ["Duloxetine", "Pregabalin"],
    note: "SNRI + gabapentinoid combo",
  },

  // ─── CATEGORY 8: Number / Unit Confusion ────────────────────
  {
    category: "Number-Confusion",
    input: "Azithromycin five hundred",     // '500' spoken as words
    expectAny: ["Azithromycin"],
    note: "Dose spoken as English words – scrubNoise can't strip these",
  },
  {
    category: "Number-Confusion",
    input: "Azithromycin 500mg",
    expectAny: ["Azithromycin"],
    note: "With numeric dose attached",
  },
  {
    category: "Number-Confusion",
    input: "Paracetamol one thousand",
    expectAny: ["Paracetamol"],
    note: "1000mg spoken as words",
  },
  {
    category: "Number-Confusion",
    input: "Levetiracetam five hundred mg",
    expectAny: ["Levetiracetam"],
    note: "500mg spoken + mg appended",
  },

  // ─── CATEGORY 9: "Sounds Like" / Heavily Distorted ──────────
  {
    category: "Sounds-Like",
    input: "safe tree exon",
    expectAny: ["Ceftriaxone"],
    note: "Alias test: Ceftriaxone heavily mangled",
  },
  {
    category: "Sounds-Like",
    input: "symthicon",
    expectAny: ["Simethicone"],
    note: "Short token jaro winkler test",
  },
  {
    category: "Sounds-Like",
    input: "tinineb",
    expectAny: ["Tinidazole"],
    note: "Short token alias / jaro winkler test",
  },

  {
    category: "Sounds-Like",
    input: "Azzitho mysin",                 // extreme STT + accent blend
    expectAny: ["Azithromycin"],
    note: "Heavy distortion of Azithromycin",
  },
  {
    category: "Sounds-Like",
    input: "Para setamol",
    expectAny: ["Paracetamol"],
    note: "Middle syllable dropped",
  },
  {
    category: "Sounds-Like",
    input: "Metha cobalamin",               // Methyl → Metha
    expectAny: ["Methylcobalamin"],
    note: "Methyl spoken as Metha",
  },
  {
    category: "Sounds-Like",
    input: "Hydroxy chloroquin",            // -ine dropped
    expectAny: ["Hydroxychloroquine"],
    note: "Hydroxychloroquine with -ine dropped",
  },
  {
    category: "Sounds-Like",
    input: "Ambroxol hydro chloride",
    expectAny: ["Ambroxol"],
    note: "Salt name spoken separately",
  },
  {
    category: "Sounds-Like",
    // "Urso deoxy cholic acid" — Ursodeoxycholic Acid is in DB.
    // After noise-scrubbing (cholic, acid, deoxy stripped), only "urso"
    // remains — too short to reliably match. Retailer would normally say
    // the full name or "UDCA". This is a Gate D / spell-it scenario.
    // Correct agent behavior: ask them to spell or say brand name.
    input: "Urso deoxy cholic acid",
    expectAny: ["Ursodeoxycholic"],
    note: "Extreme split of Ursodeoxycholic Acid — acceptable Gate D if no match",
  },
  {
    category: "Sounds-Like",
    input: "Enoxaparin sodium",
    expectAny: ["Enoxaparin"],
    note: "LMWH with salt suffix",
  },
  {
    category: "Sounds-Like",
    input: "Doxy cycline",                  // split
    expectAny: ["Doxycycline"],
    note: "Doxycycline split at common break",
  },

  // ─── CATEGORY 10: Single-Word Ambiguous queries ─────────────
  {
    category: "Short-Ambiguous",
    input: "Rifaximin",
    expectAny: ["Rifaximin"],
    note: "Gut antibiotic – uncommon name",
  },
  {
    category: "Short-Ambiguous",
    input: "Bilastine",
    expectAny: ["Bilastine"],
    note: "New-gen antihistamine",
  },
  {
    category: "Short-Ambiguous",
    input: "Vonoprazan",
    expectAny: ["Vonoprazan"],
    note: "PCAB – fairly rare",
  },
  {
    category: "Short-Ambiguous",
    input: "Sertraline",
    expectAny: ["Sertraline"],
    note: "SSRI – must match",
  },
  {
    category: "Short-Ambiguous",
    input: "Modafinil",
    expectAny: ["Modafinil"],
    note: "Wakefulness agent",
  },
  {
    category: "Short-Ambiguous",
    input: "Cabergoline",
    expectAny: ["Cabergoline"],
    note: "Dopamine agonist",
  },
  {
    category: "Short-Ambiguous",
    input: "Febuxostat",
    expectAny: ["Febuxostat"],
    note: "Gout drug",
  },
  {
    category: "Short-Ambiguous",
    input: "Silodosin",
    expectAny: ["Silodosin"],
    note: "Alpha blocker for prostate",
  },
];

// ─────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────
const PASS = "✅ PASS";
const FAIL = "❌ FAIL";
const WARN = "⚠️  WARN";

let totalTests = 0;
let passed = 0;
let failed = 0;
let warned = 0;
let noMatchExpected = 0;

const results = [];

for (const tc of tests) {
  totalTests++;
  const { status, matches } = searchByComposition(tc.input);
  const topMatch = matches[0] ?? null;
  const topScore = topMatch?.confidence ?? 0;
  const topComp = topMatch?.Composition ?? "";

  // Determine if any expected keyword is present in any match composition
  let keywordFound = false;
  if (tc.expectAny.length === 0) {
    // No match expected – success if no_match
    keywordFound = (status === "no_match");
    noMatchExpected++;
  } else {
    for (const m of matches) {
      const comp = (m.Composition ?? "").toLowerCase();
      if (tc.expectAny.some((kw) => comp.includes(kw.toLowerCase()))) {
        keywordFound = true;
        break;
      }
    }
  }

  let verdict;
  if (keywordFound) {
    verdict = PASS;
    passed++;
  } else if (status === "no_match") {
    verdict = FAIL;
    failed++;
  } else {
    // Got matches but wrong composition
    verdict = FAIL;
    failed++;
  }

  // Warn if score is borderline (80-85)
  if (verdict === PASS && topScore > 0 && topScore < 85) {
    verdict = WARN;
    warned++;
    passed--; // Don't double-count
  }

  results.push({
    verdict,
    category: tc.category,
    input: tc.input,
    note: tc.note,
    status,
    matchCount: matches.length,
    topScore: topScore.toFixed(1),
    topComp: topComp.substring(0, 60),
    expected: tc.expectAny.join(" | ") || "no_match",
  });
}

// ─────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────
console.log("\n");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("           WONNE PHONETIC COMPOSITION SEARCH — TEST REPORT");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log(`Total Tests : ${totalTests}`);
console.log(`✅ PASS     : ${passed}`);
console.log(`⚠️  WARN     : ${warned}  (borderline score 80-85)`);
console.log(`❌ FAIL     : ${failed}`);
console.log("───────────────────────────────────────────────────────────────────────────");

// Group by category
const categories = [...new Set(results.map((r) => r.category))];
for (const cat of categories) {
  const catResults = results.filter((r) => r.category === cat);
  console.log(`\n▶  ${cat}  (${catResults.length} tests)`);
  for (const r of catResults) {
    console.log(
      `  ${r.verdict} [${r.status.padEnd(24)}] score=${r.topScore.padStart(5)}  "${r.input}"`
    );
    if (r.verdict !== PASS) {
      console.log(`     expected keywords: ${r.expected}`);
      console.log(`     top composition : ${r.topComp || "(no match)"}`);
      console.log(`     note: ${r.note}`);
    }
  }
}

console.log("\n───────────────────────────────────────────────────────────────────────────");
console.log("DETAILED FAILURE & WARN LIST");
console.log("───────────────────────────────────────────────────────────────────────────");

const issues = results.filter((r) => r.verdict !== PASS);
if (issues.length === 0) {
  console.log("  🎉 No failures or warnings! All tests passed.");
} else {
  for (const r of issues) {
    console.log(`\n  ${r.verdict}`);
    console.log(`  Input    : "${r.input}"`);
    console.log(`  Category : ${r.category}`);
    console.log(`  Note     : ${r.note}`);
    console.log(`  Status   : ${r.status}  |  Matches: ${r.matchCount}  |  TopScore: ${r.topScore}`);
    console.log(`  Expected : ${r.expected}`);
    console.log(`  Got Comp : ${r.topComp || "(none)"}`);
  }
}

console.log("\n═══════════════════════════════════════════════════════════════════════════\n");
