// env.js — must be imported FIRST in server.js
// Reads .env and overrides process.env, bypassing any system-level empty vars
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env');

try {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim(); // always override empty system vars
  }
  console.log('[env] Loaded .env from', envPath);
} catch (e) {
  console.warn('[env] Could not load .env:', e.message);
}
