import { Router } from 'express';
import {
  searchOfficials, getStats, getOfficialCount, getOfficialById,
  patchOfficial, getDuplicateCandidates, mergeOfficials,
  addToWatchlist, removeFromWatchlist, getWatchlistIds, getWatchlistCount,
  getLatestRefreshLogs,
} from '../db/queries.js';
import { searchNews, getRecentNews, getNewsHighlights } from '../db/news-queries.js';
import { runAllSources, getRefreshStatus } from '../sources/index.js';
import { fetchAllNews, getNewsRefreshStatus } from '../services/news-fetcher.js';
import { draftOutreachEmail, sendOutreach, sendDigest } from '../services/email.js';

const router = Router();

// GET /api/officials — search, filter, sort, paginate
router.get('/officials', (req, res) => {
  const {
    search = '',
    department_type = 'all',
    government_level = 'all',
    state = 'all',
    source = 'all',
    sort = 'recent',
    limit = '100',
    offset = '0',
    watchlist: watchlistOnly = 'false',
  } = req.query;

  const result = searchOfficials({
    search: search.trim(),
    department_type,
    government_level,
    state,
    source,
    sort,
    limit: Math.min(parseInt(limit) || 100, 200),
    offset: parseInt(offset) || 0,
    watchlistOnly: watchlistOnly === 'true',
  });

  res.json({
    total: result.total,
    officials: result.officials.map(o => ({
      ...o,
      is_watchlisted: !!o.is_watchlisted,
    })),
    watchlistCount: getWatchlistCount(),
  });
});

// GET /api/stats — counts by department_type, government_level, state, source
router.get('/stats', (_req, res) => {
  res.json(getStats());
});

// POST /api/refresh — trigger manual data pull
router.post('/refresh', (_req, res) => {
  const current = getRefreshStatus();
  if (current && current.running) {
    return res.status(409).json({ error: 'Refresh already in progress', status: current });
  }

  runAllSources((source, msg) => {
    console.log(`[Refresh] [${source}] ${msg}`);
  }).then(result => {
    console.log(`[Refresh] Complete. Added ${result.totalAdded} new officials.`);
  }).catch(err => {
    console.error('[Refresh] Failed:', err.message);
  });

  res.json({ message: 'Refresh started', status: getRefreshStatus() });
});

// GET /api/refresh/status — check refresh progress
router.get('/refresh/status', (_req, res) => {
  const status = getRefreshStatus();
  const logs = getLatestRefreshLogs(5);
  res.json({ status: status || { running: false }, recentLogs: logs });
});

// POST /api/watchlist/:id — add to watchlist
router.post('/watchlist/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid official ID' });
  const success = addToWatchlist(id);
  res.json({ success, watchlistCount: getWatchlistCount() });
});

// DELETE /api/watchlist/:id — remove from watchlist
router.delete('/watchlist/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid official ID' });
  const success = removeFromWatchlist(id);
  res.json({ success, watchlistCount: getWatchlistCount() });
});

// GET /api/watchlist — list watchlist IDs
router.get('/watchlist', (_req, res) => {
  const ids = getWatchlistIds();
  res.json({ ids, count: ids.length });
});

// PATCH /api/officials/:id — update notes and/or deal_stage
router.patch('/officials/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid official ID' });
  const { notes, deal_stage } = req.body;
  const VALID_STAGES = ['Watching', 'Contacted'];
  if (deal_stage && !VALID_STAGES.includes(deal_stage)) {
    return res.status(400).json({ error: `Invalid deal_stage. Must be one of: ${VALID_STAGES.join(', ')}` });
  }
  const ok = patchOfficial(id, { notes, deal_stage });
  if (!ok) return res.status(400).json({ error: 'Nothing to update' });
  res.json({ success: true, official: getOfficialById(id) });
});

// GET /api/duplicates — find suspected duplicate officials
router.get('/duplicates', (_req, res) => {
  const pairs = getDuplicateCandidates();
  res.json({ count: pairs.length, pairs });
});

// POST /api/duplicates/merge — merge two officials, keep one, delete other
router.post('/duplicates/merge', (req, res) => {
  const { keepId, deleteId } = req.body;
  if (!keepId || !deleteId || keepId === deleteId) {
    return res.status(400).json({ error: 'keepId and deleteId required and must differ' });
  }
  mergeOfficials(keepId, deleteId);
  res.json({ success: true, kept: keepId, deleted: deleteId });
});

// POST /api/email/draft — generate AI outreach draft for an official
router.post('/email/draft', async (req, res) => {
  const { officialId } = req.body;
  if (!officialId) return res.status(400).json({ error: 'officialId required' });
  const official = getOfficialById(parseInt(officialId));
  if (!official) return res.status(404).json({ error: 'Official not found' });
  try {
    const draft = await draftOutreachEmail(official);
    res.json({ draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/send — send an outreach email
router.post('/email/send', async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'to, subject, and body are required' });
  }
  try {
    await sendOutreach({ to, subject, body });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/digest — trigger digest immediately (for testing)
router.post('/email/digest', async (_req, res) => {
  try {
    await sendDigest();
    res.json({ success: true, message: 'Digest sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GovTech News ──

// GET /api/news — search & filter news
router.get('/news', (req, res) => {
  const {
    category = 'all',
    search = '',
    source_type = '',
    exclude_type = '',
    limit = '50',
    offset = '0',
  } = req.query;

  const result = searchNews({
    category,
    search: search.trim(),
    source_type: source_type || undefined,
    exclude_type: exclude_type || undefined,
    limit: Math.min(parseInt(limit) || 50, 200),
    offset: parseInt(offset) || 0,
  });

  res.json(result);
});

// GET /api/news/highlights — top stories from the last 24 hours
router.get('/news/highlights', (_req, res) => {
  const items = getNewsHighlights(24, 6);
  res.json({ items });
});

// GET /api/news/recent — 5 latest news items (for sidebar)
router.get('/news/recent', (_req, res) => {
  const items = getRecentNews(5);
  res.json({ items });
});

// POST /api/news/refresh — trigger manual news fetch
router.post('/news/refresh', (_req, res) => {
  const current = getNewsRefreshStatus();
  if (current && current.running) {
    return res.status(409).json({ error: 'News refresh already in progress', status: current });
  }

  fetchAllNews((msg) => {
    console.log(`[News Refresh] ${msg}`);
  }).then(result => {
    console.log(`[News Refresh] Complete. Added ${result.added} new articles.`);
  }).catch(err => {
    console.error('[News Refresh] Failed:', err.message);
  });

  res.json({ message: 'News refresh started' });
});

// GET /api/news/status — check news refresh progress
router.get('/news/status', (_req, res) => {
  const status = getNewsRefreshStatus();
  res.json({ status: status || { running: false } });
});

export default router;
