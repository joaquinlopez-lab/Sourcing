import { fetchGitHubFounders } from './github.js';
import { fetchHNFounders } from './hackernews.js';
import { fetchRSSFounders } from './rss-feeds.js';
import { fetchGoogleFounders } from './google-search.js';
import { upsertFounder, logRefreshStart, logRefreshEnd } from '../db/queries.js';
import { dedup } from '../services/dedup.js';
import { enrichFounder } from '../services/enrichment.js';

// Track in-progress refresh
let refreshState = null;

export function getRefreshStatus() {
  return refreshState;
}

// Process results from a single source: dedup, enrich, upsert
function processSourceResults(name, rawFounders) {
  const unique = dedup(rawFounders);
  let added = 0;
  for (const founder of unique) {
    const enriched = enrichFounder(founder);
    const result = upsertFounder(enriched);
    if (result.action === 'inserted') added++;
  }
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
    },
    totalAdded: 0,
  };

  // Run all sources in parallel for speed
  await Promise.all([
    runSource('github', fetchGitHubFounders, onProgress),
    runSource('hackernews', fetchHNFounders, onProgress),
    runSource('rss', fetchRSSFounders, onProgress),
    runSource('google', fetchGoogleFounders, onProgress),
  ]);

  refreshState.running = false;
  refreshState.finishedAt = new Date().toISOString();

  return refreshState;
}
