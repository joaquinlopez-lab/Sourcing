import cron from 'node-cron';
import { runAllSources } from '../sources/index.js';
import { sendDigest } from './email.js';

let refreshTask = null;
let digestTask = null;

export function startScheduler() {
  // Run daily at 6:00 AM ET — data refresh
  refreshTask = cron.schedule('0 6 * * *', async () => {
    console.log('[Scheduler] Starting daily data refresh…');
    try {
      const result = await runAllSources((source, msg) => {
        console.log(`[Scheduler] [${source}] ${msg}`);
      });
      console.log(`[Scheduler] Refresh complete. Added ${result.totalAdded} new founders.`);
    } catch (err) {
      console.error('[Scheduler] Refresh failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // Run daily at 8:00 AM ET — email digest
  digestTask = cron.schedule('0 8 * * *', async () => {
    console.log('[Scheduler] Sending daily digest…');
    try {
      await sendDigest();
    } catch (err) {
      console.error('[Scheduler] Digest failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  console.log('[Scheduler] Daily refresh @ 6AM ET, digest @ 8AM ET');
}

export function stopScheduler() {
  if (refreshTask) { refreshTask.stop(); refreshTask = null; }
  if (digestTask)  { digestTask.stop();  digestTask = null;  }
}
