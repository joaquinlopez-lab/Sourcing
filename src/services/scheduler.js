import cron from 'node-cron';
import { runAllSources } from '../sources/index.js';

let scheduledTask = null;

export function startScheduler() {
  // Run daily at 6:00 AM ET (11:00 UTC)
  scheduledTask = cron.schedule('0 6 * * *', async () => {
    console.log('[Scheduler] Starting daily data refresh…');
    try {
      const result = await runAllSources((source, msg) => {
        console.log(`[Scheduler] [${source}] ${msg}`);
      });
      console.log(`[Scheduler] Refresh complete. Added ${result.totalAdded} new founders.`);
    } catch (err) {
      console.error('[Scheduler] Refresh failed:', err.message);
    }
  }, {
    timezone: 'America/New_York',
  });

  console.log('[Scheduler] Daily refresh scheduled for 6:00 AM ET');
}

export function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}
