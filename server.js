import './src/env.js'; // MUST be first — loads .env and overrides empty system vars
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import app from './src/app.js';
import { startScheduler } from './src/services/scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Serve frontend static files
app.use(express.static(join(__dirname, 'public')));
// SPA fallback — but don't override .html files that exist
app.get('*', (req, res) => {
  if (req.path.endsWith('.html')) {
    res.status(404).send('Not found');
  } else {
    res.sendFile(join(__dirname, 'public', 'index.html'));
  }
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`GovWell Prospect Sourcing running at http://localhost:${PORT}`);
  startScheduler();
});
