// Name normalization + dedup within a batch

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z\s]/g, '');
}

function normalizeCompany(company) {
  return (company || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b(inc|llc|ltd|co|corp|corporation|labs|studio|studios)\b\.?/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
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

export function dedup(founders) {
  const seen = new Map(); // key -> founder
  const result = [];

  for (const f of founders) {
    const nameKey = normalizeName(f.name);
    const companyKey = normalizeCompany(f.company);
    const dedupKey = `${nameKey}|${companyKey}`;

    if (seen.has(dedupKey)) continue;

    // Fuzzy match against existing entries
    let isDuplicate = false;
    for (const [key, existing] of seen) {
      const [existingName, existingCompany] = key.split('|');
      if (
        similarity(nameKey, existingName) > 0.8 &&
        similarity(companyKey, existingCompany) > 0.7
      ) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(dedupKey, f);
      result.push(f);
    }
  }

  return result;
}
