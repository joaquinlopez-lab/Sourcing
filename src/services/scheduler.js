import cron from 'node-cron';
import { runAllSources } from '../sources/index.js';
import { sendDigest } from './email.js';
import { fetchAllNews } from './news-fetcher.js';
import { cleanOldNews } from '../db/news-queries.js';

let refreshTask = null;
let digestTask = null;
let newsTask = null;

export function startScheduler() {
  // Run daily at 6:00 AM ET — official data refresh
  refreshTask = cron.schedule('0 6 * * *', async () => {
    console.log('[Scheduler] Starting daily data refresh...');
    try {
      const result = await runAllSources((source, msg) => {
        console.log(`[Scheduler] [${source}] ${msg}`);
      });
      console.log(`[Scheduler] Refresh complete. Added ${result.totalAdded} new officials.`);
    } catch (err) {
      console.error('[Scheduler] Refresh failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // Run every Monday at 8:00 AM ET — email digest
  digestTask = cron.schedule('0 8 * * 1', async () => {
    console.log('[Scheduler] Sending weekly digest...');
    try {
      await sendDigest();
    } catch (err) {
      console.error('[Scheduler] Digest failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // Run every 4 hours — govtech news refresh
  newsTask = cron.schedule('0 */4 * * *', async () => {
    console.log('[Scheduler] Refreshing govtech news...');
    try {
      const result = await fetchAllNews((msg) => {
        console.log(`[Scheduler] [news] ${msg}`);
      });
      console.log(`[Scheduler] News refresh complete. Added ${result.added} new articles.`);
    } catch (err) {
      console.error('[Scheduler] News refresh failed:', err.message);
    }
    try {
      const cleaned = cleanOldNews(90);
      if (cleaned > 0) console.log(`[Scheduler] Cleaned ${cleaned} old news articles.`);
    } catch (err) {
      console.error('[Scheduler] News cleanup failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  console.log('[Scheduler] Daily refresh @ 6AM ET, weekly digest @ Mon 8AM ET, news every 4h');
}

export function stopScheduler() {
  if (refreshTask) { refreshTask.stop(); refreshTask = null; }
  if (digestTask)  { digestTask.stop();  digestTask = null;  }
  if (newsTask)    { newsTask.stop();    newsTask = null;    }
}
