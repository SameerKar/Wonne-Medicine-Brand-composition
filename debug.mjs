
import * as fuzzball from 'fuzzball';

const compCleanQuery = 'sodium monofluorophosphate';
const cleanComp = 'potassium nitrate + sodium monofluoro phosphate + triclosan';

const isSingleToken = compCleanQuery.split(/\s+/).filter(Boolean).length === 1;
const compCleanQueryCompact = compCleanQuery.replace(/\s+/g, '');
const cleanCompCompact = cleanComp.replace(/\s+/g, '');

let compScore = Math.max(
  fuzzball.token_set_ratio(compCleanQuery, cleanComp),
  fuzzball.token_set_ratio(compCleanQueryCompact, cleanCompCompact)
);

if (isSingleToken) {
  const partial = fuzzball.partial_ratio(compCleanQuery, cleanComp);
  compScore = Math.max(compScore, partial);
}

// C1: Rejection Gates
const rawComp = 'Potassium Nitrate 5%+ Sodium monofluoro phosphate 0.7% + Triclosan 0.30%';
const saltCount = rawComp.split(/\+/).length;
if (saltCount > 2) {
  compScore = Math.min(compScore, 88);
}

function charOverlapRatio(q, c) {
  const setA = new Set(q.replace(/\s/g, '').split(''));
  const setB = new Set(c.replace(/\s/g, '').split(''));
  const intersection = [...setA].filter(ch => setB.has(ch)).length;
  return intersection / Math.max(setA.size, setB.size);
}

if (compScore < 86 && charOverlapRatio(compCleanQuery, cleanComp) < 0.55) {
  console.log('REJECTED BY CHAR OVERLAP! Score:', compScore, 'Overlap:', charOverlapRatio(compCleanQuery, cleanComp));
  compScore = 0;
}

console.log('Final compScore:', compScore);


