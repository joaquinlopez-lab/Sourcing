import { createLimiter } from '../utils/rate-limiter.js';
import {
  REAL_NAME_RE, GOV_TITLE_KEYWORDS,
  classifyDepartmentType, classifyPositionType, classifyGovernmentLevel, normalizeState,
} from '../utils/constants.js';

const throttle = createLimiter('google', { maxRequests: 5, windowMs: 60_000 });

const GOV_TITLE_RE = /\b(city manager|city administrator|planning director|building official|building director|CIO|CTO|IT director|procurement|purchasing|code enforcement|public works|permitting|zoning|building department|planning department|community development)\b/i;

export async function fetchGoogleOfficials(onProgress) {
  const apiKey = process.env.GOOGLE_CSE_KEY;
  const searchEngineId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !searchEngineId) {
    if (onProgress) onProgress('Google Search skipped (no API key)');
    return [];
  }

  const queries = [
    'site:linkedin.com/in "city manager" OR "planning director" OR "building official" local government',
    'site:linkedin.com/in "CIO" OR "IT director" municipal government',
    '"staff directory" "planning" OR "building" OR "permits" director contact site:*.gov',
    '"city manager" OR "city administrator" contact email site:*.gov',
    '"procurement officer" OR "purchasing director" local government municipality',
    '"building department" director OR manager city government contact',
  ];

  const officials = [];
  const seenUrls = new Set();

  for (let i = 0; i < queries.length; i++) {
    if (onProgress) onProgress(`Google Search (${i + 1}/${queries.length})...`);
    await throttle();

    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(queries[i])}&num=10`;
      const resp = await fetch(url);
      if (!resp.ok) continue;

      const data = await resp.json();

      for (const item of (data.items || [])) {
        const link = item.link || '';
        if (seenUrls.has(link)) continue;
        seenUrls.add(link);

        const isLinkedIn = link.includes('linkedin.com/in/');
        const isGovSite = /\.gov\b|\.us\b/.test(link);

        if (!isLinkedIn && !isGovSite) continue;

        const snippet = item.snippet || '';
        const combined = `${item.title || ''} ${snippet}`;

        // Must have government title keyword
        if (!GOV_TITLE_RE.test(combined)) continue;

        let name = '';
        let officialTitle = '';
        let municipality = '';
        let linkedinUrl = null;

        if (isLinkedIn) {
          // LinkedIn title: "John Smith - City Manager - City of Austin | LinkedIn"
          const parts = (item.title || '').split(/\s*[-–—|]\s*/);
          name = parts[0]?.trim() || '';
          officialTitle = parts[1]?.trim() || '';
          municipality = parts[2]?.trim() || '';
          linkedinUrl = link;

          if (!REAL_NAME_RE.test(name)) continue;
          if (!GOV_TITLE_RE.test(`${officialTitle} ${municipality} ${snippet}`)) continue;

        } else {
          // Gov site — try to extract name from snippet
          const namePatterns = [
            /([A-Z][a-z]+ [A-Z][a-z]+),?\s+(?:the\s+)?(?:city manager|planning director|building|IT director|CIO|procurement|public works|code enforcement)/i,
            /(?:Director|Manager|Chief|Administrator|Officer):\s*([A-Z][a-z]+ [A-Z][a-z]+)/i,
          ];

          for (const re of namePatterns) {
            const m = combined.match(re);
            if (m && REAL_NAME_RE.test(m[1].trim())) {
              name = m[1].trim();
              break;
            }
          }
          if (!name) continue;

          // Extract title
          const titleMatch = combined.match(/((?:City|Town|County|Deputy|Assistant)?\s*(?:Manager|Administrator|Director|Chief|Officer|Clerk|Engineer|Planner|Inspector|Commissioner|Superintendent)(?:\s+of\s+[\w\s]+)?)/i);
          officialTitle = titleMatch ? titleMatch[1].trim() : '';

          // Extract municipality
          const muniMatch = combined.match(/(?:City of|Town of|Village of|County of)\s+([A-Z][a-zA-Z\s]+?)(?:\s*[,|.\n]|$)/);
          municipality = muniMatch ? muniMatch[0].replace(/[,|.\n]$/, '').trim() : '';
        }

        if (!name) continue;

        const emailMatch = snippet.match(/[\w.+-]+@[\w-]+\.(?:gov|us|org)\b/);
        const phoneMatch = snippet.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        const state = normalizeState(extractStateFromSnippet(combined));

        officials.push({
          name,
          title: officialTitle,
          department: officialTitle,
          municipality,
          state,
          county: '',
          government_level: classifyGovernmentLevel(combined, link),
          department_type: classifyDepartmentType(officialTitle, ''),
          position_type: classifyPositionType(officialTitle),
          population: 0,
          description: snippet.slice(0, 250),
          email: emailMatch ? emailMatch[0] : null,
          phone: phoneMatch ? phoneMatch[0] : null,
          linkedin_url: linkedinUrl,
          website: isGovSite ? link : null,
          source: 'google',
          source_url: link,
          discovered_date: new Date().toISOString().slice(0, 10),
          confidence_score: 0.6,
        });
      }
    } catch (err) {
      console.warn('Google Search error:', err.message);
    }
  }

  return officials;
}

function extractStateFromSnippet(text) {
  // Look for state abbreviation patterns
  const stateMatch = text.match(/,\s*([A-Z]{2})\b/);
  if (stateMatch) return stateMatch[1];
  return '';
}
