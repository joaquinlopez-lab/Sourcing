import { Router } from 'express';
import {
  searchFounders, getStats, getFounderCount,
  addToWatchlist, removeFromWatchlist, getWatchlistIds, getWatchlistCount,
  getLatestRefreshLogs,
} from '../db/queries.js';
import { runAllSources, getRefreshStatus } from '../sources/index.js';

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

export default router;
