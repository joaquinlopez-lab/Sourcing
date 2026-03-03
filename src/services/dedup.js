// Name + municipality normalization + dedup within a batch

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z\s]/g, '');
}

function normalizeMunicipality(muni) {
  return (muni || '')
    .toLowerCase()
    .trim()
    .replace(/\b(city of|town of|village of|county of|borough of)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Simple similarity check (Jaccard on character bigrams)
function similarity(a, b) {
  if (!a || !b) return 0;
  const bigramsA = new Set();
  const bigramsB = new Set();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersection = 0;
  for (const bg of bigramsA) if (bigramsB.has(bg)) intersection++;
  return intersection / (bigramsA.size + bigramsB.size - intersection);
}

export function dedup(officials) {
  const seen = new Map();
  const result = [];

  for (const o of officials) {
    const nameKey = normalizeName(o.name);
    const muniKey = normalizeMunicipality(o.municipality);
    const deptKey = (o.department_type || '').toLowerCase().trim();
    const dedupKey = `${nameKey}|${muniKey}|${deptKey}`;

    if (seen.has(dedupKey)) continue;

    // Fuzzy match against existing entries
    let isDuplicate = false;
    for (const [key] of seen) {
      const [existingName, existingMuni] = key.split('|');
      if (
        similarity(nameKey, existingName) > 0.8 &&
        similarity(muniKey, existingMuni) > 0.7
      ) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(dedupKey, o);
      result.push(o);
    }
  }

  return result;
}
