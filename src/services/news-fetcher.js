import RssParser from 'rss-parser';
import { createLimiter } from '../utils/rate-limiter.js';
import { upsertNewsItem } from '../db/news-queries.js';

const parser = new RssParser();
const exaThrottle = createLimiter('exa-news', { maxRequests: 5, windowMs: 60_000 });

// ── RSS Feed Sources (GovTech / Municipal) ──

const RSS_FEEDS = [
  { name: 'Government Technology', url: 'https://www.govtech.com/rss',                    category: 'technology' },
  { name: 'Route Fifty',          url: 'https://www.route-fifty.com/rss/',                 category: 'policy' },
  { name: 'Governing',            url: 'https://www.governing.com/rss',                    category: 'policy' },
  { name: 'American City & County', url: 'https://www.americancityandcounty.com/feed/',    category: 'general' },
  { name: 'Smart Cities Dive',    url: 'https://www.smartcitiesdive.com/feeds/news/',      category: 'technology' },
  { name: 'GovLoop',              url: 'https://www.govloop.com/feed/',                    category: 'general' },
];

// ── Exa Neural Search Queries ──

const EXA_NEWS_QUERIES = [
  {
    query: 'local government implements new permitting software platform digital transformation',
    category: 'technology',
    numResults: 10,
  },
  {
    query: 'municipal government RFP procurement permitting licensing planning software',
    category: 'procurement',
    numResults: 10,
  },
  {
    query: 'city county government modernizes building permits inspections code enforcement technology',
    category: 'technology',
    numResults: 10,
  },
  {
    query: 'govtech startup local government permit licensing planning software',
    category: 'general',
    numResults: 10,
  },
];

// ── Fetch RSS Feeds ──

async function fetchRSSNews(onProgress) {
  const items = [];

  for (const feed of RSS_FEEDS) {
    if (onProgress) onProgress(`Reading ${feed.name}...`);

    try {
      const parsed = await parser.parseURL(feed.url);

      for (const entry of (parsed.items || []).slice(0, 15)) {
        const title = (entry.title || '').trim();
        if (!title) continue;

        const url = (entry.link || '').trim();
        if (!url) continue;

        items.push({
          title,
          url,
          source_name: feed.name,
          source_type: 'rss',
          summary: (entry.contentSnippet || '').slice(0, 300).trim() || null,
          category: feed.category,
          published_at: entry.isoDate || null,
          image_url: extractImage(entry) || null,
        });
      }
    } catch (err) {
      console.warn(`[News RSS] ${feed.name} failed:`, err.message);
    }
  }

  return items;
}

function extractImage(entry) {
  if (entry.enclosure?.url) return entry.enclosure.url;
  const content = entry['content:encoded'] || entry.content || '';
  const match = content.match(/<img[^>]+src="([^"]+)"/);
  return match ? match[1] : null;
}

// ── Fetch Exa News ──

async function fetchExaNews(onProgress) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return [];

  const items = [];
  const seenUrls = new Set();
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (let i = 0; i < EXA_NEWS_QUERIES.length; i++) {
    const q = EXA_NEWS_QUERIES[i];
    if (onProgress) onProgress(`Exa news search (${i + 1}/${EXA_NEWS_QUERIES.length})...`);

    await exaThrottle();

    try {
      const resp = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          query: q.query,
          type: 'neural',
          num_results: q.numResults,
          startPublishedDate: startDate,
          contents: { text: { max_characters: 500 } },
        }),
      });

      if (!resp.ok) {
        console.warn(`[News Exa] Query ${i + 1} HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();

      for (const result of data.results || []) {
        const url = (result.url || '').trim();
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);

        items.push({
          title: (result.title || '').trim() || url,
          url,
          source_name: extractDomain(url),
          source_type: 'exa',
          summary: (result.text || '').slice(0, 300).trim() || null,
          category: q.category,
          published_at: result.publishedDate || null,
          image_url: null,
        });
      }
    } catch (err) {
      console.warn(`[News Exa] Query ${i + 1} failed:`, err.message);
    }
  }

  return items;
}

function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  } catch {
    return 'Unknown';
  }
}

// ── Main entry point ──

let newsRefreshState = null;

export function getNewsRefreshStatus() {
  return newsRefreshState;
}

export async function fetchAllNews(onProgress) {
  newsRefreshState = { running: true, startedAt: new Date().toISOString() };

  try {
    if (onProgress) onProgress('Fetching RSS feeds...');
    const rssItems = await fetchRSSNews(onProgress);

    if (onProgress) onProgress('Fetching Exa news...');
    const exaItems = await fetchExaNews(onProgress);

    const allItems = [...rssItems, ...exaItems];

    const seenUrls = new Set();
    const unique = [];
    for (const item of allItems) {
      if (seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);
      unique.push(item);
    }

    let added = 0;
    for (const item of unique) {
      const result = upsertNewsItem(item);
      if (result.changes > 0) added++;
    }

    newsRefreshState = {
      running: false,
      finishedAt: new Date().toISOString(),
      fetched: unique.length,
      added,
    };

    if (onProgress) onProgress(`Done — ${added} new articles added`);
    return newsRefreshState;
  } catch (err) {
    newsRefreshState = { running: false, error: err.message };
    throw err;
  }
}
