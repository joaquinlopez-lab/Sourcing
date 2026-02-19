import Database from 'better-sqlite3';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

const EXA_API_KEY = process.env.EXA_API_KEY;
if (!EXA_API_KEY) {
  console.error('EXA_API_KEY not set in .env');
  process.exit(1);
}

const db = new Database(resolve(__dirname, '..', 'data', 'founders.db'));

// Rate limiter: 10 req/min
const timestamps = [];
async function throttle() {
  const now = Date.now();
  while (timestamps.length > 0 && now - timestamps[0] > 60_000) timestamps.shift();
  if (timestamps.length >= 10) {
    const wait = 60_000 - (now - timestamps[0]);
    console.log(`  Rate limit: waiting ${Math.ceil(wait / 1000)}s…`);
    await new Promise(r => setTimeout(r, wait));
    while (timestamps.length > 0 && Date.now() - timestamps[0] > 60_000) timestamps.shift();
  }
  timestamps.push(Date.now());
}

async function searchExa(query, category = 'news') {
  await throttle();
  const body = {
    query,
    type: 'auto',
    num_results: 5,
    category,
    contents: { text: { max_characters: 1000 } },
  };
  const resp = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': EXA_API_KEY },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    console.warn(`  Exa API error ${resp.status}: ${resp.statusText}`);
    return [];
  }
  const data = await resp.json();
  return data.results || [];
}

// Group founders by company
const allFounders = db.prepare('SELECT * FROM founders ORDER BY company, id').all();
const companies = new Map();
for (const f of allFounders) {
  if (!companies.has(f.company)) companies.set(f.company, []);
  companies.get(f.company).push(f);
}

console.log(`\nVerifying ${allFounders.length} founders across ${companies.size} companies via Exa…\n`);

const updates = [];
let companyIdx = 0;

for (const [companyName, founders] of companies) {
  companyIdx++;
  console.log(`[${companyIdx}/${companies.size}] ${companyName} (${founders.map(f => f.name).join(', ')})`);

  // Search for this company's funding announcement
  const query = `"${companyName}" NYC startup funding raise`;
  let results = await searchExa(query);

  // If no results from news, try company category
  if (results.length === 0) {
    results = await searchExa(`${companyName} startup New York`, 'company');
  }

  if (results.length === 0) {
    console.log('  No Exa results found — skipping\n');
    continue;
  }

  // Combine all result text for analysis
  const combinedText = results.map(r => `${r.title || ''} ${r.text || ''}`).join(' ');
  const combinedLower = combinedText.toLowerCase();

  // Check raise amount
  const raiseMatch = combinedText.match(/\$([\d,.]+)\s*(million|m\b)/i)
    || combinedText.match(/\$([\d,.]+)\s*M/);
  let exaRaised = null;
  if (raiseMatch) {
    const num = parseFloat(raiseMatch[1].replace(/,/g, ''));
    exaRaised = `$${num}M`;
  }

  // Check stage
  let exaStage = null;
  if (/series\s*b/i.test(combinedLower)) exaStage = 'Series B';
  else if (/series\s*a/i.test(combinedLower)) exaStage = 'Series A';
  else if (/pre[- ]?seed/i.test(combinedLower)) exaStage = 'Pre-seed';
  else if (/seed/i.test(combinedLower)) exaStage = 'Seed';

  // Check website
  let exaWebsite = null;
  for (const r of results) {
    const url = r.url || '';
    if (!url.includes('techcrunch') && !url.includes('alleywatch') && !url.includes('crunchbase')
        && !url.includes('bloomberg') && !url.includes('businessinsider')
        && !url.includes('forbes') && !url.includes('linkedin')) {
      // Might be the company's own site
      try {
        const host = new URL(url).hostname.replace('www.', '');
        if (host.toLowerCase().includes(companyName.toLowerCase().replace(/\s+/g, ''))
            || companyName.toLowerCase().replace(/\s+/g, '').includes(host.split('.')[0])) {
          exaWebsite = url;
        }
      } catch {}
    }
  }

  // Check sector from text
  let exaSector = null;
  if (/\b(ai|machine learning|ml|deep learning|llm|gpt|neural)\b/.test(combinedLower)) exaSector = 'Vertical AI';
  if (/\b(fintech|financial|banking|payments|lending|defi|crypto|stablecoin)\b/.test(combinedLower)) exaSector = 'Fintech';
  if (/\b(cyber|security|infosec|encryption|threat)\b/.test(combinedLower)) exaSector = 'Cybersecurity';
  if (/\b(health|medical|bio|pharma|clinical|patient)\b/.test(combinedLower)) exaSector = 'Healthcare Tech';

  // Check for additional founder names not in our DB
  const founderNames = founders.map(f => f.name.toLowerCase());
  const namePatterns = [
    /(?:co-?founder|ceo|cto)\s+([A-Z][a-z]+ [A-Z][a-z]+)/gi,
    /([A-Z][a-z]+ [A-Z][a-z]+)(?:,?\s+(?:co-?founder|ceo|cto))/gi,
  ];
  const mentionedNames = new Set();
  for (const re of namePatterns) {
    let m;
    while ((m = re.exec(combinedText)) !== null) {
      mentionedNames.add(m[1].trim());
    }
  }

  // Report findings
  const currentRaised = founders[0].raised;
  const currentStage = founders[0].stage;
  const currentSector = founders[0].sector;
  const currentWebsite = founders[0].website;

  let changes = [];

  if (exaRaised && exaRaised !== currentRaised) {
    changes.push(`  RAISE: "${currentRaised}" → "${exaRaised}" (Exa)`);
  }
  if (exaStage && exaStage !== currentStage) {
    changes.push(`  STAGE: "${currentStage}" → "${exaStage}" (Exa)`);
  }
  if (exaSector && exaSector !== currentSector) {
    changes.push(`  SECTOR: "${currentSector}" → "${exaSector}" (Exa)`);
  }
  if (exaWebsite && !currentWebsite) {
    changes.push(`  WEBSITE: added "${exaWebsite}" (Exa)`);
  }

  // Check for name mentions
  for (const name of mentionedNames) {
    if (!founderNames.includes(name.toLowerCase()) && name !== companyName) {
      changes.push(`  NOTE: "${name}" mentioned as founder but not in DB`);
    }
  }

  if (changes.length === 0) {
    console.log('  ✓ Verified — no discrepancies\n');
    continue;
  }

  console.log('  Discrepancies found:');
  for (const c of changes) console.log(c);
  console.log();

  // Queue DB updates for this company's founders
  for (const founder of founders) {
    const update = { id: founder.id, fields: {} };
    if (exaRaised && exaRaised !== currentRaised) update.fields.raised = exaRaised;
    if (exaStage && exaStage !== currentStage) update.fields.stage = exaStage;
    if (exaSector && exaSector !== currentSector) update.fields.sector = exaSector;
    if (exaWebsite && !founder.website) update.fields.website = exaWebsite;
    if (Object.keys(update.fields).length > 0) updates.push(update);
  }
}

// Apply updates
if (updates.length === 0) {
  console.log('\n=== No updates needed — all founders verified! ===\n');
} else {
  console.log(`\n=== Applying ${updates.length} updates ===\n`);

  const updateStmt = db.prepare(`
    UPDATE founders
    SET raised = COALESCE(?, raised),
        stage = COALESCE(?, stage),
        sector = COALESCE(?, sector),
        website = COALESCE(?, website),
        updated_at = datetime('now')
    WHERE id = ?
  `);

  const applyAll = db.transaction(() => {
    for (const u of updates) {
      updateStmt.run(
        u.fields.raised || null,
        u.fields.stage || null,
        u.fields.sector || null,
        u.fields.website || null,
        u.id
      );
      console.log(`  Updated founder #${u.id}: ${JSON.stringify(u.fields)}`);
    }
  });

  applyAll();
  console.log('\nDone! All updates applied.\n');
}

db.close();
