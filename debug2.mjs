
import { searchMedicine } from './src/search/omniIndex.js';
import * as fuzzball from 'fuzzball';

const q = 'Guaifenesin';
const res = searchMedicine(q);
console.log('Result:', res.status, res.matches.length);

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

const compCleanQuery = scrubNoise(q);
const cleanComp = scrubNoise('Levosalbutamol 0.25mg + Ambroxol Hydrochloride 7.5mg + Guaiphenesin 12.5mg');
const compCleanQueryCompact = compCleanQuery.replace(/\s+/g, '');
const cleanCompCompact = cleanComp.replace(/\s+/g, '');
const isSingleToken = compCleanQuery.split(/\s+/).filter(Boolean).length === 1;

let fullScore = Math.max(
  fuzzball.token_set_ratio(compCleanQuery, cleanComp),
  fuzzball.token_set_ratio(compCleanQueryCompact, cleanCompCompact)
);

if (isSingleToken) {
  fullScore = Math.max(fullScore, fuzzball.partial_ratio(compCleanQuery, cleanComp));
}

let maxSaltScore = 0;
const salts = cleanComp.split('+').map(s => s.trim());
for (const salt of salts) {
  let saltScore = Math.max(
    fuzzball.token_set_ratio(compCleanQuery, salt),
    fuzzball.token_set_ratio(compCleanQueryCompact, salt.replace(/\s+/g, ''))
  );
  if (isSingleToken) {
    saltScore = Math.max(saltScore, fuzzball.partial_ratio(compCleanQuery, salt));
  }
  if (saltScore > maxSaltScore) maxSaltScore = saltScore;
}

let compScore = fullScore;
if (maxSaltScore < 80) compScore = maxSaltScore;

console.log('compScore:', compScore);
console.log('fullScore:', fullScore);
console.log('maxSaltScore:', maxSaltScore);

const saltCount = cleanComp.split('+').length;
if (saltCount > 2) {
  compScore = Math.min(compScore, 88);
}
console.log('after salt cap:', compScore);

function cOverlap(q, c) {
  const setA = new Set(q.replace(/\s/g, '').split(''));
  const setB = new Set(c.replace(/\s/g, '').split(''));
  const intersection = [...setA].filter(ch => setB.has(ch)).length;
  return intersection / Math.max(setA.size, setB.size);
}
console.log('overlap:', cOverlap(compCleanQuery, cleanComp));

if (compScore < 86 && cOverlap(compCleanQuery, cleanComp) < 0.55) {
  console.log('REJECTED');
  compScore = 0;
}
console.log('FINAL compScore:', compScore);


