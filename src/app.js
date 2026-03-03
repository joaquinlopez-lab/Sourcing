import express from 'express';

import { initSchema } from './db/schema.js';
import { getOfficialCount } from './db/queries.js';
import apiRoutes from './routes/api.js';
import chatRoutes from './routes/chat.js';

// ── Initialize database (runs once per process / cold start) ──
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  console.log('Initializing database…');
  initSchema();
  console.log(`Database ready with ${getOfficialCount()} officials.`);
  initialized = true;
}

ensureInitialized();

// ── Express app ──
const app = express();
app.use(express.json());

// API routes
app.use('/api', apiRoutes);
app.use('/api', chatRoutes);

// API 404 handler
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
