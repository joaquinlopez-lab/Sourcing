import 'dotenv/config';
import express from 'express';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

import { initSchema } from './db/schema.js';
import { upsertFounder, getFounderCount } from './db/queries.js';
import apiRoutes from './routes/api.js';
import chatRoutes from './routes/chat.js';

// ── Initialize database (runs once per process / cold start) ──
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  console.log('Initializing database…');
  initSchema();

  const count = getFounderCount();
  if (count === 0) {
    // Try multiple paths (local dev vs Netlify bundled)
    const candidates = [
      join(process.cwd(), 'data', 'seed.json'),
      join(process.cwd(), '..', 'data', 'seed.json'),
    ];

    for (const seedPath of candidates) {
      if (existsSync(seedPath)) {
        console.log('Seeding database with starter founders…');
        const seedData = JSON.parse(readFileSync(seedPath, 'utf-8'));
        let seeded = 0;
        for (const founder of seedData) {
          upsertFounder(founder);
          seeded++;
        }
        console.log(`Seeded ${seeded} founders.`);
        break;
      }
    }
  }

  console.log(`Database ready with ${getFounderCount()} founders.`);
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
