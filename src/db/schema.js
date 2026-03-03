import db from './connection.js';

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS officials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      title TEXT DEFAULT '',
      department TEXT DEFAULT '',
      municipality TEXT DEFAULT '',
      state TEXT DEFAULT '',
      county TEXT DEFAULT '',
      government_level TEXT DEFAULT 'City',
      department_type TEXT DEFAULT '',
      position_type TEXT DEFAULT '',
      population INTEGER DEFAULT 0,
      description TEXT DEFAULT '',
      email TEXT,
      phone TEXT,
      linkedin_url TEXT,
      website TEXT,
      source TEXT DEFAULT 'exa',
      source_url TEXT,
      confidence_score REAL DEFAULT 0.5,
      notes TEXT DEFAULT '',
      deal_stage TEXT DEFAULT 'Watching',
      discovered_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      official_id INTEGER NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (official_id),
      FOREIGN KEY (official_id) REFERENCES officials(id) ON DELETE CASCADE
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS govtech_news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      source_name TEXT NOT NULL,
      source_type TEXT DEFAULT 'rss',
      summary TEXT,
      category TEXT DEFAULT 'general',
      published_at TEXT,
      image_url TEXT,
      fetched_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_state ON officials(state)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_dept_type ON officials(department_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_gov_level ON officials(government_level)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_position_type ON officials(position_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_municipality ON officials(municipality)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_name ON officials(name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_email ON officials(email)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_population ON officials(population)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_deal_stage ON officials(deal_stage)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_discovered ON officials(discovered_date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_officials_source ON officials(source)`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_govnews_category ON govtech_news(category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_govnews_published ON govtech_news(published_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_govnews_url ON govtech_news(url)`);
}
