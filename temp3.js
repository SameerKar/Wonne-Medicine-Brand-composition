
import { searchMedicine } from './src/search/omniIndex.js';
import * as fuzzball from 'fuzzball';
import { medicineDb } from './src/data/medicines.js';

function charOverlapRatio(q, c) {
  const setA = new Set(q.replace(/\s/g, '').split(''));
  const setB = new Set(c.replace(/\s/g, '').split(''));
  const intersection = [...setA].filter(ch => setB.has(ch)).length;
  return intersection / Math.max(setA.size, setB.size);
}

const q = 'Sodium Monofluorophosphate';
const res = searchMedicine(q);
console.log('Result:', res.status, res.matches);

function scrubNoise(inputStr) {
  return inputStr
    .toLowerCase()
    .replace(/\b(mg|ml|gm|mcg|iu|spores|tablet|capsule|syrup|drop|plus|injection|softgel|sr|er|xr|dt|lb|ip|usp|bp|hcl|hbr)\b/gi, '')
    .replace(/[0-9]+(\.[0-9]+)?/g, '')
    .replace(/\([0-9]+:[0-9]+\)/g, '')
    .replace(/%/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const qC = scrubNoise(q);
for (const item of medicineDb) {
  if (item['Brand Name'] === 'Quinea') {
    console.log('Testing Quinea...');
    const cleanComp = scrubNoise(item.Composition);
    const compCleanQueryCompact = qC.replace(/\s+/g, '');
    const cleanCompCompact = cleanComp.replace(/\s+/g, '');
    let compScore = Math.max(
      fuzzball.token_set_ratio(qC, cleanComp),
      fuzzball.token_set_ratio(compCleanQueryCompact, cleanCompCompact)
    );
    console.log('Initial score:', compScore);
    const saltCount = item.Composition.split(/\+/).length;
    if (saltCount > 2) compScore = Math.min(compScore, 88);
    console.log('After saltCount:', compScore);
    
    if (compScore < 86 && charOverlapRatio(qC, cleanComp) < 0.55) {
      console.log('Rejected by char overlap');
      continue;
    }
    
    console.log('Final comp score:', compScore);
  }
}

