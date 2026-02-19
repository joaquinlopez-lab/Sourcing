import Database from 'better-sqlite3';
import { join } from 'node:path';

const DB_PATH = join(process.cwd(), 'data', 'founders.db');
const db = new Database(DB_PATH);

// Count before
const before = db.prepare('SELECT COUNT(*) as c FROM founders').get().c;
const bySource = db.prepare('SELECT source, COUNT(*) as c FROM founders GROUP BY source').all();
console.log(`Before cleanup: ${before} founders`);
console.log('By source:', bySource);

// Delete all non-AlleyWatch sourced founders (exa, github, hackernews, etc.)
const result = db.prepare("DELETE FROM founders WHERE source NOT IN ('AlleyWatch', 'seed')").run();
console.log(`\nDeleted ${result.changes} fake/unverified profiles`);

// Count after
const after = db.prepare('SELECT COUNT(*) as c FROM founders').get().c;
const bySourceAfter = db.prepare('SELECT source, COUNT(*) as c FROM founders GROUP BY source').all();
console.log(`After cleanup: ${after} founders`);
console.log('By source:', bySourceAfter);

db.close();
