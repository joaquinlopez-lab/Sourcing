import db from './connection.js';

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS founders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'Founder',
      company TEXT,
      description TEXT,
      sector TEXT,
      stage TEXT,
      raised TEXT,
      raised_amount REAL DEFAULT 0,
      location TEXT DEFAULT 'New York, NY',
      linkedin_url TEXT,
      website TEXT,
      github_url TEXT,
      avatar_url TEXT,
      source TEXT DEFAULT 'seed',
      funded_date TEXT,
      is_stealth INTEGER DEFAULT 0,
      confidence_score REAL DEFAULT 0.3,
      notes TEXT DEFAULT '',
      deal_stage TEXT DEFAULT 'Watching',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      founder_id INTEGER NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (founder_id),
      FOREIGN KEY (founder_id) REFERENCES founders(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      records_found INTEGER DEFAULT 0,
      records_added INTEGER DEFAULT 0,
      error TEXT,
      status TEXT DEFAULT 'running'
    )
  `);

  // ── Migrations for existing databases ──
  try { db.exec(`ALTER TABLE founders ADD COLUMN notes TEXT DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE founders ADD COLUMN deal_stage TEXT DEFAULT 'Watching'`); } catch {}

  // Indexes for common queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_founders_sector ON founders(sector)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_founders_stage ON founders(stage)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_founders_source ON founders(source)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_founders_name ON founders(name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_founders_company ON founders(company)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_founders_funded_date ON founders(funded_date DESC)`);
}
