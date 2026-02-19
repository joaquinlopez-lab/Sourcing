import { fetchGitHubFounders } from './github.js';
import { fetchHNFounders } from './hackernews.js';
import { fetchRSSFounders } from './rss-feeds.js';
import { fetchGoogleFounders } from './google-search.js';
import { fetchExaFounders } from './exa.js';
import { upsertFounder, logRefreshStart, logRefreshEnd } from '../db/queries.js';
import { dedup } from '../services/dedup.js';
import { enrichFounder } from '../services/enrichment.js';

// Track in-progress refresh
let refreshState = null;

export function getRefreshStatus() {
  return refreshState;
}

// ── Validation gate — every founder from every source must pass this ──

// Known tech journalists / writers that get misidentified as founders
const JOURNALIST_BLOCKLIST = new Set([
  'mary ann azevedo', 'anthony ha', 'connie loizos', 'kate clark',
  'ingrid lunden', 'natasha mascarenhas', 'harri weber', 'sarah perez',
  'manish singh', 'alex wilhelm', 'kirsten korosec', 'amir efrati',
  'eric newcomer', 'elaine watson', 'kirstyn brendlen', 'kristina klaas',
  'chris walker', 'growth list team', 'access intercomm',
]);

// Words that indicate the "name" is actually an org/article/junk, not a person
const JUNK_NAME_PATTERNS = [
  /^(written by|guide to|claims|nyc supports|arab founders)/i,
  /^(tech:nyc|techcrunch|list of|funded|series [abc])/i,
  /\b(team|inc|llc|corp|markets|intercomm|newsletter)\b/i,
  /^[a-z]/,           // starts with lowercase = username, not a name
  /^[A-Z]{2,}\b/,     // ALL CAPS first word = acronym
  /[_\d@]/,           // underscores, numbers, @ = username
  /^.{0,4}$/,         // too short to be a real name
  /^.{50,}$/,         // too long
];

// Validates name looks like "First Last" (2-4 words, proper case)
const REAL_NAME_RE = /^[A-Z][a-z]{1,20} [A-Z][a-z]{1,20}(\s[A-Z][a-z]{1,20}){0,2}$/;

function validateFounder(founder) {
  const name = (founder.name || '').trim();

  // 1. Must have a name
  if (!name) return 'no name';

  // 2. Name must look like a real person (First Last)
  if (!REAL_NAME_RE.test(name)) return `bad name format: "${name}"`;

  // 3. Not a known journalist
  if (JOURNALIST_BLOCKLIST.has(name.toLowerCase())) return `journalist: "${name}"`;

  // 4. Name doesn't match junk patterns
  for (const re of JUNK_NAME_PATTERNS) {
    if (re.test(name)) return `junk name: "${name}"`;
  }

  // 5. Must have a real company name
  const company = (founder.company || '').trim();
  if (!company || company === 'Unknown') return 'no company';
  if (company.startsWith('http')) return `company is URL: "${company}"`;
  if (/^\w+ Labs$/i.test(company) && company.split(' ')[0].length < 4) return `fake lab name: "${company}"`;

  // 6. Description can't be mostly HTML/navigation junk
  const desc = (founder.description || '');
  const junkRatio = (desc.match(/\[|#{2,}|📅|---|\|/g) || []).length;
  if (junkRatio > 3) return `junk description`;

  return null; // passes validation
}

// Process results from a single source: validate, dedup, enrich, upsert
function processSourceResults(name, rawFounders) {
  const unique = dedup(rawFounders);
  let added = 0;
  let rejected = 0;
  for (const founder of unique) {
    const rejection = validateFounder(founder);
    if (rejection) {
      console.log(`[Validate] REJECTED from ${name}: ${rejection}`);
      rejected++;
      continue;
    }
    const enriched = enrichFounder(founder);
    const result = upsertFounder(enriched);
    if (result.action === 'inserted') added++;
  }
  if (rejected > 0) console.log(`[Validate] ${name}: rejected ${rejected}/${unique.length} profiles`);
  return added;
}

// Run a single source with logging and state updates
async function runSource(name, fn, onProgress) {
  refreshState.sources[name].status = 'running';
  const logId = logRefreshStart(name);

  try {
    const rawFounders = await fn((msg) => {
      if (onProgress) onProgress(name, msg);
    });

    refreshState.sources[name].found = rawFounders.length;

    const added = processSourceResults(name, rawFounders);

    refreshState.sources[name].added = added;
    refreshState.sources[name].status = 'done';
    refreshState.totalAdded += added;

    logRefreshEnd(logId, rawFounders.length, added);
  } catch (err) {
    console.error(`Source ${name} failed:`, err.message);
    refreshState.sources[name].status = 'error';
    refreshState.sources[name].error = err.message;
    logRefreshEnd(logId, 0, 0, err.message);
  }
}

export async function runAllSources(onProgress) {
  refreshState = {
    running: true,
    startedAt: new Date().toISOString(),
    sources: {
      github: { status: 'pending', found: 0, added: 0 },
      hackernews: { status: 'pending', found: 0, added: 0 },
      rss: { status: 'pending', found: 0, added: 0 },
      google: { status: 'pending', found: 0, added: 0 },
      exa: { status: 'pending', found: 0, added: 0 },
    },
    totalAdded: 0,
  };

  // Run all sources in parallel for speed
  await Promise.all([
    runSource('github', fetchGitHubFounders, onProgress),
    runSource('hackernews', fetchHNFounders, onProgress),
    runSource('rss', fetchRSSFounders, onProgress),
    runSource('google', fetchGoogleFounders, onProgress),
    runSource('exa', fetchExaFounders, onProgress),
  ]);

  refreshState.running = false;
  refreshState.finishedAt = new Date().toISOString();

  return refreshState;
}
