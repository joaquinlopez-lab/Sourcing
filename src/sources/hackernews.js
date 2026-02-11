import { createLimiter } from '../utils/rate-limiter.js';

const throttle = createLimiter('hackernews', { maxRequests: 15, windowMs: 60_000 });

const QUERIES = [
  'Show HN NYC startup',
  'NYC founder seed funding',
  'New York startup launch',
  'Show HN AI startup New York',
  'NYC stealth startup',
];

function classifySector(text) {
  const lower = (text || '').toLowerCase();
  if (/\b(ai|machine learning|ml|deep learning|llm|gpt|neural|nlp|computer vision)\b/.test(lower)) return 'Vertical AI';
  if (/\b(cyber|security|infosec|encryption|zero.?trust|threat)\b/.test(lower)) return 'Cybersecurity';
  if (/\b(health|medical|bio|pharma|clinical|patient|doctor|genomic)\b/.test(lower)) return 'Healthcare Tech';
  return 'SaaS';
}

function extractCompany(title) {
  // Try to get company from "Show HN: CompanyName - description" pattern
  const showHnMatch = title.match(/^Show HN:\s*([^–\-—]+)/i);
  if (showHnMatch) return showHnMatch[1].trim();

  // Try "CompanyName (YC ...)" pattern
  const ycMatch = title.match(/^([^(]+)\s*\(YC/i);
  if (ycMatch) return ycMatch[1].trim();

  return null;
}

function parseRaisedFromTitle(title) {
  const match = title.match(/\$(\d+(?:\.\d+)?)\s*([MmKk])/);
  if (!match) return '';
  return `$${match[1]}${match[2].toUpperCase()}`;
}

export async function fetchHNFounders(onProgress) {
  const founders = [];
  const seenAuthors = new Set();

  for (let i = 0; i < QUERIES.length; i++) {
    const query = QUERIES[i];
    if (onProgress) onProgress(`Searching Hacker News (${i + 1}/${QUERIES.length})…`);

    await throttle();

    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10`;
      const resp = await fetch(url);
      if (!resp.ok) continue;

      const data = await resp.json();

      for (const hit of (data.hits || [])) {
        const author = hit.author;
        if (!author || seenAuthors.has(author)) continue;
        seenAuthors.add(author);

        const title = hit.title || '';
        const company = extractCompany(title);
        if (!company) continue; // Skip if we can't identify a company

        const isStealth = title.toLowerCase().includes('stealth');
        const text = `${title} ${hit.story_text || ''}`;

        founders.push({
          name: author,
          role: isStealth ? 'Founder (Stealth)' : 'Founder',
          company,
          description: title,
          sector: classifySector(text),
          stage: 'Pre-seed',
          raised: parseRaisedFromTitle(title),
          location: 'New York, NY',
          linkedin_url: null,
          website: hit.url || null,
          github_url: null,
          avatar_url: null,
          source: 'hackernews',
          funded_date: hit.created_at ? hit.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
          is_stealth: isStealth,
          confidence_score: 0.4,
        });
      }
    } catch (err) {
      console.warn('HN API error:', err.message);
    }
  }

  return founders;
}
