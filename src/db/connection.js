import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// Use /tmp in Netlify (serverless, ephemeral), local data/ directory otherwise
const isNetlify = !!process.env.NETLIFY;
const DB_PATH = isNetlify
  ? '/tmp/officials.db'
  : join(process.cwd(), 'data', 'officials.db');

if (!isNetlify) {
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;
