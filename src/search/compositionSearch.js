import { token_set_ratio, partial_ratio } from "fuzzball";
import { medicineDb } from "../data/medicines.js";

// ============================================================
// Composition-Only Search Logic — Voice-Optimized Strict Mode
// ============================================================
// This module is the single source of truth for all medicine
// lookups triggered by the Maansi Voice Agent (Section 9 of
// WonneAgentPrompt.md).
//
// The output `status` field directly maps to the Agent's
// 4-Gate Routing Matrix:
//
//   "exact_match"           → GATE A  (1 valid item — confirm immediately)
//   "multiple_exact_matches"→ GATE B  (same salt, multiple variants/dosages)
//   "multiple_options"      → GATE C  (different salts — ask to clarify)
//   "no_match"              → GATE D  (nothing found — ask to spell)
//
// The agent's Internal Cross-Check Filter (Section 9) is the
// agent's responsibility AFTER receiving this payload.  This
// module's job is to return the best possible candidate set
// even when the caller's voice input is phonetically distorted.
// ============================================================

// ─────────────────────────────────────────────────────────────
// STEP 1 — PHONETIC NORMALIZER
// Corrects the most common Indian-English accent patterns and
// STT (speech-to-text) engine transcription errors BEFORE any
// fuzzy scoring is attempted.
//
// Agent reference: Section 9 — "spoken_words" input handling.
// ─────────────────────────────────────────────────────────────
function phoneticNormalize(str) {
  const ALIASES = {
    "ceftriaxone": ["safe tree exon", "safetria exon", "safetria-exon", "pre-exon", "seftriaxon", "septriaxone"],
    "cefixime":    ["sefixime", "sefixim"],
    "tinidazole":  ["tinineb", "tinidazol"],
    "simethicone": ["symthicon", "simeticone"],
  };

  let normalizedStr = str.toLowerCase();

  // Alias expansion for severely mangled names
  for (const [canonical, mangledList] of Object.entries(ALIASES)) {
    for (const mangled of mangledList) {
      if (normalizedStr.includes(mangled)) {
        normalizedStr = normalizedStr.replace(mangled, canonical);
      }
    }
  }

  return normalizedStr
    // ── Consonant sound-alikes (Indian-English accent) ──────
    // "Siprofloxacin" → "Ciprofloxacin" (C→S at word-start)
    .replace(/\bsi([aeiou])/g, "ci$1")
    // "sy-" prefix sound-alike (also fixes symthicon → simethicon)
    .replace(/\bsy([mn])/g, "si$1")
    .replace(/\bsy([aeiou])/g, "cy$1")
    // "ph" → "f"
    .replace(/ph/g, "f")
    // "ks" → "x" (levofloksasin → levofloxasin)
    .replace(/ks/g, "x")
    // ── Terminal suffix normalizations ──────────────────────
    // IMPORTANT: patterns are scoped tightly to avoid corrupting
    // correct words (e.g. sol→zole must NOT fire on Levosalbutamol).
    //
    // -sin at word end → -cin  (siprofloxasin → siprofloxacin)
    .replace(/sin\b/g, "cin")
    // -rin at word end → -rine (drotaverin → drotaverine)
    .replace(/rin\b/g, "rine")
    // -quin at word end → -quine (hydroxychloroquin → hydroxychloroquine)
    .replace(/quin\b/g, "quine")
    // -alin/-ilin at word end → -allin/-illin (only bare suffix drops)
    // Scoped to prevent "cillin" → "cilllin" triple-l bug
    .replace(/([^l])ilin\b/g, "$1illin")   // amoxy[c]ilin → amoxy[c]illin
    .replace(/([^l])alin\b/g, "$1allin")   // similar pattern
    // -prazol/-azol at word end → -prazole/-azole
    // Scoped to NOT fire inside words like "Levosalbutamol"
    .replace(/prazol\b/g, "prazole")        // pantoprazol → pantoprazole
    .replace(/([^a-z])azol\b/g, "$1azole") // rabeprazol → rabeprazole
    // -pine suffix (amlodipine)
    .replace(/pin\b/g, "pine");
}

// ─────────────────────────────────────────────────────────────
// STEP 2 — NOISE SCRUBBER
// Removes units, dosage numbers, and filler words so that the
// fuzzy engine compares only the core chemical name tokens.
//
// Agent reference: Section 9 Rule 5 (TTS Number Spelling) means
// the caller may say "five hundred mg" — the number words are
// harmless but "mg" must be stripped.  Numeric digits are also
// stripped to avoid the "Number Trap" (e.g. "Cefixime 200"
// scoring high against "Cefpodoxime 200" purely on the number).
// ─────────────────────────────────────────────────────────────
function scrubNoise(inputStr) {
  return inputStr
    .toLowerCase()
    // ── Pharma form / route / standard suffixes ──────────────
    .replace(/\b(mg|ml|gm|mcg|iu|spores|tablet|capsule|syrup|drop|plus|injection|sr|er|xr|dt|lb|ip|usp|bp|hcl|hbr)\b/gi, "")
    // ── Salt / chemical descriptor words often spoken aloud ──
    // These are NOT part of the core chemical name but retailers
    // frequently say them: "Ambroxol Hydro Chloride",
    // "Ursodeoxycholic Acid", "Potassium Clavulanate".
    // Stripping them lets the fuzzy engine match the core name.
    .replace(/\b(hydrochloride|hydro|chloride|sulphate|sulfate|sodium|potassium|acid|cholic|oxide|nitrate|citrate|gluconate|acetate|tartrate|succinate|fumarate|maleate|monohydrate|trihydrate|dihydrate|anhydrous|anhydrous|phosphate|carbonate|bicarbonate)\b/gi, "")
    // ── Numbers (inc. decimals) ──────────────────────────────
    .replace(/[0-9]+(\.[0-9]+)?/g, "")
    // ── Collapse extra spaces ────────────────────────────────
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─────────────────────────────────────────────────────────────
// STEP 3 — CHARACTER OVERLAP GATE
// Anti-false-positive guard for borderline scores (80–85).
// When the score is borderline, we require that the query and
// the matched composition share at least 55% of their unique
// character sets.
//
// Agent reference: Section 9 "Internal Cross-Check Filter" —
// this is the algorithmic partner of the agent's semantic check.
// It catches cases like "Azithrocillin" (wrong suffix) scoring
// 80 against Azithromycin purely on the "Azithro" prefix.
// ─────────────────────────────────────────────────────────────
function charOverlapRatio(a, b) {
  const setA = new Set(a.replace(/\s/g, "").split(""));
  const setB = new Set(b.replace(/\s/g, "").split(""));
  const intersection = [...setA].filter((c) => setB.has(c)).length;
  return intersection / Math.max(setA.size, setB.size);
}

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT — searchByComposition
//
// Algorithm (voice-optimised, 4-layer):
//   1. phoneticNormalize  → fix accent + STT consonant errors
//   2. scrubNoise         → remove units, numbers, dosage words
//   3. Multi-form scoring → score both spaced and compacted
//      forms so split-word STT errors ("methyl cobalamin"
//      matching "Methylcobalamin") are resolved
//   4. partial_ratio      → for single-token queries, use
//      partial_ratio to tolerate terminal suffix drops
//   5. charOverlapRatio   → anti-false-positive gate for
//      borderline scores (< 86)
//
// Returns status that maps directly to Section 9 Gate A/B/C/D.
// ─────────────────────────────────────────────────────────────

/**
 * Run a voice-optimised composition-only fuzzy lookup.
 *
 * @param {string} query  – raw spoken input from STT / voice agent
 * @returns {{
 *   status: "no_match" | "exact_match" | "multiple_exact_matches" | "multiple_options",
 *   matches: object[]
 * }}
 *
 * STATUS → AGENT GATE MAPPING (Section 9):
 *   "exact_match"            → GATE A — confirm single item immediately
 *   "multiple_exact_matches" → GATE B — same salt, ask for variant/mg
 *   "multiple_options"       → GATE C — different salts, ask to clarify
 *   "no_match"               → GATE D — nothing found, ask to spell
 */
export function searchByComposition(query) {
  // ── Layer 1: Phonetic normalisation then noise scrub ────────
  const normalized  = phoneticNormalize(query);
  const cleanQuery  = scrubNoise(normalized);

  // ── Layer 2: Compact form for split-word STT errors ─────────
  // "methyl cobalamin" → "methylcobalamin" to match DB tokens
  const compactQuery = cleanQuery.replace(/\s+/g, "");

  // ── Layer 3: Single-token flag for partial_ratio scoring ────
  const isSingleToken =
    cleanQuery.split(/\s+/).filter(Boolean).length === 1;

  const finalMatches = [];
  let highestScore = 0;

  for (const item of medicineDb) {
    const rawComp = (item["Composition"] || "").toLowerCase();

    // Skip empty or unavailable compositions
    if (!rawComp || rawComp.includes("not available")) continue;

    const cleanComp   = scrubNoise(rawComp);
    const compactComp = cleanComp.replace(/\s+/g, "");

    // ── Scoring: take the best of all form combinations ───────
    //
    // Why 3 forms?
    //   cleanQuery   vs cleanComp   → normal spaced comparison
    //   compactQuery vs cleanComp   → STT split-word fix
    //     ("methyl cobalamin" vs "methylcobalamin ...")
    //   cleanQuery   vs compactComp → DB merged-token fix
    //     ("methyl cobalamin" vs a DB entry stored as one token)
    let compScore = Math.max(
      token_set_ratio(cleanQuery,   cleanComp),
      token_set_ratio(compactQuery, cleanComp),
      token_set_ratio(cleanQuery,   compactComp)
    );

    // ── partial_ratio for single-token queries ─────────────────
    // Catches terminal vowel drops:
    //   "Metronidazol" → matches "Metronidazole"
    //   "Drotaverin"   → matches "Drotaverine"
    // partial_ratio checks if the shorter string is a fuzzy
    // substring of the longer one — ideal for suffix elisions.
    if (isSingleToken) {
      compScore = Math.max(
        compScore,
        partial_ratio(cleanQuery, cleanComp)
      );

      // Penalize multi-salt compositions for single-token queries
      // If caller just says "amoxicillin", a 4-drug combo capsule shouldn't score 100
      const saltCount = rawComp.split(/\+/).length;
      if (saltCount > 2) {
        compScore = Math.min(compScore, 88);
      }
    }

    // ── Anti-false-positive gate (borderline 80–85 scores) ────
    // Prevents wrong-suffix matches like "Azithrocillin" (score 80)
    // from polluting the Gate A/B payload that the agent receives.
    // A char-overlap < 55% on a borderline score is a strong signal
    // that the match is a fuzzy accident, not a phonetic variant.
    if (compScore >= 80.0) {
      if (compScore < 86 && charOverlapRatio(cleanQuery, cleanComp) < 0.55) {
        continue; // Reject borderline false-positive
      }

      finalMatches.push({
        ...item,
        matched_via: "Composition",
        confidence: compScore,
      });

      if (compScore > highestScore) {
        highestScore = compScore;
      }
    }
  }

  // Sort by confidence descending
  finalMatches.sort((a, b) => b.confidence - a.confidence);

  // ── GATE D: Zero valid items → Agent asks caller to spell ───
  if (finalMatches.length === 0) {
    return { status: "no_match", matches: [] };
  }

  // ── Determine Gate A vs B vs C ───────────────────────────────
  // highestScore >= 85 → the engine is confident enough to
  //   distinguish single (Gate A) from multiple (Gate B/C)
  // highestScore  < 85 → confidence is borderline → Gate C
  //   (agent will use conversational hook to clarify)
  let status = "multiple_options"; // Gate C default
  if (highestScore >= 85.0) {
    const topScorers = finalMatches.filter(
      (m) => m.confidence === highestScore
    );
    // Gate A: exactly 1 item at the top score
    // Gate B: 2+ items at the same top score (same salt variants)
    status =
      topScorers.length === 1 ? "exact_match" : "multiple_exact_matches";
  }

  // Limit payload to top 9 results (agent's cross-check handles the rest)
  return { status, matches: finalMatches.slice(0, 9) };
}
