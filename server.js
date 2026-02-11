import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import app from './src/app.js';
import { startScheduler } from './src/services/scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Serve frontend (local dev only — Netlify serves static files via CDN)
app.use(express.static(join(__dirname, 'public')));
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`Roo Capital Sourcing running at http://localhost:${PORT}`);
  startScheduler();
});
