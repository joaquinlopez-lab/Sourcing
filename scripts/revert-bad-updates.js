import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(resolve(__dirname, '..', 'data', 'founders.db'));
const seed = JSON.parse(readFileSync(resolve(__dirname, '..', 'data', 'seed.json'), 'utf-8'));

// Build lookup from seed.json (the trusted source)
const seedByName = new Map();
for (const f of seed) seedByName.set(f.name, f);

// --- Reverts: restore original values where Exa matched wrong companies ---
// The issue: generic company names matched different real companies in Exa results.
// We trust the original AlleyWatch-sourced data for these fields, but KEEP website additions.

const reverts = [
  // Cosmos — matched a different company; restore raise + sector
  { ids: [2, 3], fields: { raised: '$15M', sector: 'SaaS' } },
  // Claim Health — $50M is way too high for a seed startup; restore raise
  { ids: [19, 20], fields: { raised: '$4.4M', stage: 'Seed' } },
  // Galaxy — matched Galaxy Digital (crypto fund); restore everything
  { ids: [29, 30], fields: { raised: '$4M', sector: 'SaaS', website: '' } },
  // HeyMilo — wrong raise + sector (HR AI, not fintech)
  { ids: [66, 67], fields: { raised: '$3.9M', sector: 'Vertical AI' } },
  // Dux Security — IS cybersecurity, not healthcare
  { ids: [34, 35, 36], fields: { sector: 'Cybersecurity', stage: 'Seed' } },
  // Ciphero — IS cybersecurity, not healthcare
  { ids: [51, 52], fields: { sector: 'Cybersecurity' } },
  // Concourse — Vertical AI for finance, not cybersecurity
  { ids: [8, 9], fields: { sector: 'Vertical AI' } },
  // CloudForge — Vertical AI for metals supply chain, not healthcare
  { ids: [25, 26], fields: { sector: 'Vertical AI', stage: 'Seed' } },
  // Autonomous Technologies Group — Vertical AI for finance, not healthcare
  { ids: [6, 7], fields: { sector: 'Vertical AI' } },
  // Arbor — Vertical AI for voice data, not fintech; stage was Seed
  { ids: [57, 58], fields: { sector: 'Vertical AI', stage: 'Seed' } },
  // Nerd Apply — EdTech/SaaS, not cybersecurity
  { ids: [14, 15], fields: { sector: 'SaaS' } },
  // Parable — SaaS for enterprise ops, not healthcare; stage was Seed not Series B
  { ids: [49, 50], fields: { sector: 'SaaS', stage: 'Seed' } },
  // Tenbin Labs — Fintech (asset tokenization), not healthcare
  { ids: [10, 11], fields: { sector: 'Fintech' } },
  // Cvector — SaaS (industrial data), not fintech
  { ids: [12, 13], fields: { sector: 'SaaS' } },
  // Channel3 — SaaS (commerce data API), not Vertical AI
  { ids: [42, 43], fields: { sector: 'SaaS' } },
  // Sante — SaaS (POS for liquor stores), not fintech
  { ids: [55, 56], fields: { sector: 'SaaS' } },
  // Pelgo — keep as Seed (original), Series A seems wrong for $5.5M
  { ids: [53, 54], fields: { stage: 'Seed' } },
];

console.log('Reverting incorrect Exa-based updates…\n');

const revertAll = db.transaction(() => {
  for (const revert of reverts) {
    const setClauses = Object.keys(revert.fields).map(k => `${k} = ?`).join(', ');
    const values = Object.values(revert.fields);
    const placeholders = revert.ids.map(() => '?').join(', ');

    const sql = `UPDATE founders SET ${setClauses}, updated_at = datetime('now') WHERE id IN (${placeholders})`;
    db.prepare(sql).run(...values, ...revert.ids);

    const names = db.prepare(`SELECT name FROM founders WHERE id IN (${placeholders})`).all(...revert.ids);
    console.log(`  Reverted ${names.map(n => n.name).join(', ')}: ${JSON.stringify(revert.fields)}`);
  }
});

revertAll();

// Summary: what GOOD changes remain
console.log('\n=== Retained valid updates ===\n');

const retained = [
  'AIR Platforms: stage Seed → Pre-seed',
  'Advance: stage Seed → Series A',
  'Barnwell Bio: website added',
  'Chakra Labs: website added',
  'Channel3: website added (reverted sector)',
  'Concourse: website added (reverted sector)',
  'Cyphlens: website added',
  'FINNY: website added',
  'Nerd Apply: stage Seed → Pre-seed',
  'Oasys Health: stage Seed → Pre-seed',
  'Orchestra Health: website added',
  'Sante: website added (reverted sector)',
  'Tivara: stage Seed → Pre-seed',
  'Whetstone Research: stage Seed → Pre-seed',
  'ZeroDrift: sector SaaS → Cybersecurity (compliance firewall — reasonable)',
  'Arbor: website added (reverted stage+sector)',
];

for (const r of retained) console.log(`  ✓ ${r}`);

console.log('\nDone! Bad data reverted, good additions kept.\n');
db.close();
