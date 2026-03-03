import Anthropic from '@anthropic-ai/sdk';
import { fetchExaOfficials } from './exa.js';
import { fetchGoogleOfficials } from './google-search.js';
import { fetchRSSOfficials } from './rss-feeds.js';
import { upsertOfficial, logRefreshStart, logRefreshEnd } from '../db/queries.js';
import { dedup } from '../services/dedup.js';
import { enrichOfficial } from '../services/enrichment.js';
import {
  REAL_NAME_RE, GOV_TITLE_KEYWORDS, KNOWN_FEDERAL_FIGURES, NON_OFFICIAL_PATTERNS,
} from '../utils/constants.js';

let refreshState = null;

export function getRefreshStatus() {
  return refreshState;
}

// ── Validation gate — every official must pass this ──

const JUNK_NAME_PATTERNS = [
  /^[a-z]/,           // starts with lowercase
  /^[A-Z]{2,}\b/,     // ALL CAPS first word = acronym
  /[_\d@]/,           // usernames
  /^.{0,4}$/,         // too short
  /^.{50,}$/,         // too long
];

function validateOfficial(official) {
  const name = (official.name || '').trim();

  if (!name) return 'no name';
  if (!REAL_NAME_RE.test(name)) return `bad name format: "${name}"`;
  if (KNOWN_FEDERAL_FIGURES.has(name.toLowerCase())) return `federal figure: "${name}"`;

  for (const re of JUNK_NAME_PATTERNS) {
    if (re.test(name)) return `junk name: "${name}"`;
  }

  // Must have a municipality
  const municipality = (official.municipality || '').trim();
  if (!municipality) return 'no municipality';

  // Must have a title or department
  const title = (official.title || '').trim();
  const department = (official.department || '').trim();
  if (!title && !department) return 'no title or department';

  // Title must contain at least one gov-relevant keyword
  const combinedTitle = `${title} ${department}`.toLowerCase();
  const hasGovKeyword = GOV_TITLE_KEYWORDS.some(kw => combinedTitle.includes(kw));
  if (!hasGovKeyword) return `no gov keyword in title: "${title}"`;

  // Must not match non-official patterns
  for (const re of NON_OFFICIAL_PATTERNS) {
    if (re.test(combinedTitle)) return `non-official pattern: "${title}"`;
  }

  // Description quality
  const desc = (official.description || '');
  if (/Agree & Join LinkedIn|clicking Continue/i.test(desc)) return 'LinkedIn boilerplate';

  return null;
}

// ── AI batch validation ──

let _anthropicClient = null;
function getAnthropicClient() {
  if (!_anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    _anthropicClient = new Anthropic({ apiKey });
  }
  return _anthropicClient;
}

async function aiBatchValidate(officials) {
  const client = getAnthropicClient();
  if (!client) return new Map();

  const numbered = officials.map((o, i) =>
    `${i + 1}. Name: ${o.name} | Title: ${o.title || ''} | Municipality: ${o.municipality || ''} | Dept: ${o.department_type || ''} | Desc: ${(o.description || '').slice(0, 150)}`
  ).join('\n');

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are a strict filter for a US local government official sourcing tool.
For EACH person below, answer YES or NO. Answer NO if ANY apply:
- Person is from the private sector (not a government employee)
- Person is a journalist, writer, or blogger
- Person is a federal government official (Congress, White House, federal agencies)
- Person is a political candidate, not a current office holder
- Municipality name is a parsing artifact or not a real US municipality
- Title/role is not related to local government operations
- Person works for a private consulting firm, not the government itself
- Person appears to be from outside the United States

${numbered}

Reply with ONLY a numbered list like:
1. YES
2. NO
3. YES`,
      }],
    });

    const reply = (msg.content[0]?.text || '').trim();
    const results = new Map();
    for (const line of reply.split('\n')) {
      const m = line.match(/^(\d+)\.\s*(YES|NO)/i);
      if (m) {
        const idx = parseInt(m[1]) - 1;
        if (idx >= 0 && idx < officials.length) {
          results.set(idx, m[2].toUpperCase() === 'YES');
        }
      }
    }
    return results;
  } catch (err) {
    console.warn('[AI Gate Batch] Error:', err.message);
    return new Map();
  }
}

// Process results from a single source
async function processSourceResults(name, rawOfficials) {
  const unique = dedup(rawOfficials);
  let added = 0;
  let rejected = 0;
  let aiRejected = 0;

  // Step 1: Rule-based validation
  const rulePassedOfficials = [];
  for (const official of unique) {
    const rejection = validateOfficial(official);
    if (rejection) {
      console.log(`[Validate] REJECTED from ${name}: ${rejection}`);
      rejected++;
    } else {
      rulePassedOfficials.push(official);
    }
  }

  // Step 2: Batch AI validation
  if (rulePassedOfficials.length > 0) {
    const BATCH_SIZE = 20;
    const aiPassedOfficials = [];

    for (let i = 0; i < rulePassedOfficials.length; i += BATCH_SIZE) {
      const batch = rulePassedOfficials.slice(i, i + BATCH_SIZE);
      const results = await aiBatchValidate(batch);

      for (let j = 0; j < batch.length; j++) {
        const passed = results.get(j);
        if (passed === false) {
          console.log(`[AI Gate] REJECTED from ${name}: ${batch[j].name} @ ${batch[j].municipality}`);
          aiRejected++;
        } else {
          aiPassedOfficials.push(batch[j]);
        }
      }
    }

    // Step 3: Enrich and upsert
    for (const official of aiPassedOfficials) {
      const enriched = enrichOfficial(official);
      const result = upsertOfficial(enriched);
      if (result.action === 'inserted') added++;
    }
  }

  if (rejected > 0 || aiRejected > 0) {
    console.log(`[Validate] ${name}: rule-rejected=${rejected} ai-rejected=${aiRejected} passed=${rulePassedOfficials.length - aiRejected}`);
  }
  return added;
}

async function runSource(name, fn, onProgress) {
  refreshState.sources[name].status = 'running';
  const logId = logRefreshStart(name);

  try {
    const rawOfficials = await fn((msg) => {
      if (onProgress) onProgress(name, msg);
    });

    refreshState.sources[name].found = rawOfficials.length;

    const added = await processSourceResults(name, rawOfficials);

    refreshState.sources[name].added = added;
    refreshState.sources[name].status = 'done';
    refreshState.totalAdded += added;

    logRefreshEnd(logId, rawOfficials.length, added);
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
      exa:    { status: 'pending', found: 0, added: 0 },
      google: { status: 'pending', found: 0, added: 0 },
      rss:    { status: 'pending', found: 0, added: 0 },
    },
    totalAdded: 0,
  };

  await Promise.all([
    runSource('exa', fetchExaOfficials, onProgress),
    runSource('google', fetchGoogleOfficials, onProgress),
    runSource('rss', fetchRSSOfficials, onProgress),
  ]);

  refreshState.running = false;
  refreshState.finishedAt = new Date().toISOString();

  return refreshState;
}
