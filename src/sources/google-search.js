import { createLimiter } from '../utils/rate-limiter.js';

const throttle = createLimiter('google', { maxRequests: 5, windowMs: 60_000 });

// Google Custom Search Engine — optional, needs GOOGLE_CSE_KEY and GOOGLE_CSE_ID in .env
export async function fetchGoogleFounders(onProgress) {
  const apiKey = process.env.GOOGLE_CSE_KEY;
  const searchEngineId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !searchEngineId) {
    if (onProgress) onProgress('Google Search skipped (no API key)');
    return [];
  }

  const queries = [
    'site:linkedin.com/in NYC startup founder 2025',
    'site:linkedin.com/in "New York" CEO stealth startup',
    'site:crunchbase.com "New York" seed funding 2025',
  ];

  const founders = [];
  const seenUrls = new Set();

  for (let i = 0; i < queries.length; i++) {
    if (onProgress) onProgress(`Google Search (${i + 1}/${queries.length})…`);

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
        const isCrunchbase = link.includes('crunchbase.com');

        if (!isLinkedIn && !isCrunchbase) continue;

        // Extract name from title
        // LinkedIn: "FirstName LastName - Title - Company | LinkedIn"
        // Crunchbase: "CompanyName - Crunchbase Company Profile"
        let name = '';
        let company = '';
        let linkedinUrl = null;

        if (isLinkedIn) {
          const parts = (item.title || '').split(/\s*[-–—|]\s*/);
          name = parts[0]?.trim() || '';
          company = parts[2]?.trim() || parts[1]?.trim() || '';
          linkedinUrl = link;
        } else {
          company = (item.title || '').replace(/\s*[-–—].*/,'').trim();
          name = `${company} Founder`;
        }

        if (!name) continue;

        const snippet = item.snippet || '';
        const isStealth = snippet.toLowerCase().includes('stealth');

        founders.push({
          name,
          role: isStealth ? 'Founder (Stealth)' : 'Founder',
          company: company || 'Unknown',
          description: snippet.slice(0, 200),
          sector: classifySectorFromSnippet(snippet),
          stage: 'Seed',
          raised: '',
          location: 'New York, NY',
          linkedin_url: linkedinUrl,
          website: isCrunchbase ? link : null,
          github_url: null,
          avatar_url: null,
          source: 'google',
          funded_date: new Date().toISOString().slice(0, 10),
          is_stealth: isStealth,
          confidence_score: 0.6,
        });
      }
    } catch (err) {
      console.warn('Google Search error:', err.message);
    }
  }

  return founders;
}

function classifySectorFromSnippet(text) {
  const lower = (text || '').toLowerCase();
  if (/\b(ai|machine learning|ml|deep learning|llm|gpt|neural)\b/.test(lower)) return 'Vertical AI';
  if (/\b(cyber|security|infosec|encryption|threat)\b/.test(lower)) return 'Cybersecurity';
  if (/\b(health|medical|bio|pharma|clinical|patient)\b/.test(lower)) return 'Healthcare Tech';
  return 'SaaS';
}
