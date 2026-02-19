import { Router } from 'express';
import {
  searchFounders, getStats, getFounderCount, getFounderById,
  patchFounder, getDuplicateCandidates, mergeFounders,
  addToWatchlist, removeFromWatchlist, getWatchlistIds, getWatchlistCount,
  getLatestRefreshLogs,
} from '../db/queries.js';
import { runAllSources, getRefreshStatus } from '../sources/index.js';
import { draftOutreachEmail, sendOutreach, sendDigest } from '../services/email.js';

const router = Router();

// GET /api/founders — search, filter, sort, paginate
router.get('/founders', (req, res) => {
  const {
    search = '',
    sector = 'all',
    stage = 'all',
    source = 'all',
    sort = 'recent',
    limit = '100',
    offset = '0',
    watchlist: watchlistOnly = 'false',
  } = req.query;

  const result = searchFounders({
    search: search.trim(),
    sector,
    stage,
    source,
    sort,
    limit: Math.min(parseInt(limit) || 100, 200),
    offset: parseInt(offset) || 0,
    watchlistOnly: watchlistOnly === 'true',
  });

  // Attach watchlist IDs to response
  const watchlistIds = getWatchlistIds();

  res.json({
    total: result.total,
    founders: result.founders.map(f => ({
      ...f,
      is_stealth: !!f.is_stealth,
      is_watchlisted: watchlistIds.includes(f.id),
    })),
    watchlistCount: getWatchlistCount(),
  });
});

// GET /api/stats — counts by sector, stage, source
router.get('/stats', (_req, res) => {
  res.json(getStats());
});

// POST /api/refresh — trigger manual data pull
router.post('/refresh', (_req, res) => {
  const current = getRefreshStatus();
  if (current && current.running) {
    return res.status(409).json({ error: 'Refresh already in progress', status: current });
  }

  // Start async — respond immediately
  runAllSources((source, msg) => {
    console.log(`[Refresh] [${source}] ${msg}`);
  }).then(result => {
    console.log(`[Refresh] Complete. Added ${result.totalAdded} new founders.`);
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
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid founder ID' });
  const success = addToWatchlist(id);
  res.json({ success, watchlistCount: getWatchlistCount() });
});

// DELETE /api/watchlist/:id — remove from watchlist
router.delete('/watchlist/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid founder ID' });
  const success = removeFromWatchlist(id);
  res.json({ success, watchlistCount: getWatchlistCount() });
});

// GET /api/watchlist — list watchlist IDs
router.get('/watchlist', (_req, res) => {
  const ids = getWatchlistIds();
  res.json({ ids, count: ids.length });
});

// PATCH /api/founders/:id — update notes and/or deal_stage
router.patch('/founders/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid founder ID' });
  const { notes, deal_stage } = req.body;
  const VALID_STAGES = ['Watching', 'Reached Out', 'In Conversation', 'Passed', 'Invested'];
  if (deal_stage && !VALID_STAGES.includes(deal_stage)) {
    return res.status(400).json({ error: `Invalid deal_stage. Must be one of: ${VALID_STAGES.join(', ')}` });
  }
  const ok = patchFounder(id, { notes, deal_stage });
  if (!ok) return res.status(400).json({ error: 'Nothing to update' });
  res.json({ success: true, founder: getFounderById(id) });
});

// GET /api/duplicates — find suspected duplicate founders
router.get('/duplicates', (_req, res) => {
  const pairs = getDuplicateCandidates();
  res.json({ count: pairs.length, pairs });
});

// POST /api/duplicates/merge — merge two founders, keep one, delete other
router.post('/duplicates/merge', (req, res) => {
  const { keepId, deleteId } = req.body;
  if (!keepId || !deleteId || keepId === deleteId) {
    return res.status(400).json({ error: 'keepId and deleteId required and must differ' });
  }
  mergeFounders(keepId, deleteId);
  res.json({ success: true, kept: keepId, deleted: deleteId });
});

// POST /api/email/draft — generate AI outreach draft for a founder
router.post('/email/draft', async (req, res) => {
  const { founderId } = req.body;
  if (!founderId) return res.status(400).json({ error: 'founderId required' });
  const founder = getFounderById(parseInt(founderId));
  if (!founder) return res.status(404).json({ error: 'Founder not found' });
  try {
    const draft = await draftOutreachEmail(founder);
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

export default router;
