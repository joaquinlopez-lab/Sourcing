import { createLimiter } from '../utils/rate-limiter.js';

const throttle = createLimiter('hackernews', { maxRequests: 15, windowMs: 60_000 });

const QUERIES = [
  'Show HN NYC startup funding',
  'Show HN New York startup launch',
  'Show HN NYC founder seed',
  'Show HN AI startup New York raised',
];

// Only accept posts from the last 12 months
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Titles that are NOT about a real startup launch
const JUNK_TITLE_PATTERNS = [
  /\b(hire me|hiring|job board|looking for|database of|list of)\b/i,
  /\b(students?|high school|meetup|party|event|summer time)\b/i,
  /\b(free forever|open.?source tool|alternative to)\b/i,
  /\b(meet the \d+|group of)\b/i,
];

// Extract a real "First Last" founder name from title or body text
const FOUNDER_NAME_PATTERNS = [
  /(?:founded by|founder|co-founder|ceo)[,:]?\s+([A-Z][a-z]+ [A-Z][a-z]+)/i,
  /([A-Z][a-z]+ [A-Z][a-z]+)[,']?s?\s+(?:founded|launched|started|built|created)/i,
  /([A-Z][a-z]+ [A-Z][a-z]+),?\s+(?:founder|co-founder|ceo)\b/i,
];

function classifySector(text) {
  const lower = (text || '').toLowerCase();
  if (/\b(ai|machine learning|ml|deep learning|llm|gpt|neural|nlp|computer vision)\b/.test(lower)) return 'Vertical AI';
  if (/\b(fintech|financial|banking|payments|lending)\b/.test(lower)) return 'Fintech';
  if (/\b(cyber|security|infosec|encryption|zero.?trust|threat)\b/.test(lower)) return 'Cybersecurity';
  if (/\b(health|medical|bio|pharma|clinical|patient|doctor|genomic)\b/.test(lower)) return 'Healthcare Tech';
  if (/\b(climate|cleantech|energy|sustainability|carbon)\b/.test(lower)) return 'Climate Tech';
  return 'SaaS';
}

function extractCompany(title) {
  // "Show HN: CompanyName – description" or "Show HN: CompanyName - description"
  const showHnMatch = title.match(/^Show HN:\s*([^–\-—:]+)/i);
  if (showHnMatch) {
    const name = showHnMatch[1].trim();
    // Company name: 1-3 words, starts with uppercase, reasonable length
    if (/^[A-Z][A-Za-z0-9.]+(\s[A-Z][A-Za-z0-9.]+){0,2}$/.test(name) && name.length <= 30) {
      return name;
    }
  }

  // "CompanyName (YC S24)" pattern
  const ycMatch = title.match(/^([A-Z][A-Za-z0-9]+(?:\s[A-Z][A-Za-z0-9]+){0,2})\s*\(YC/i);
  if (ycMatch) return ycMatch[1].trim();

  return null;
}

function parseRaisedFromTitle(title) {
  const match = title.match(/\$(\d+(?:\.\d+)?)\s*([MmKk])/);
  if (!match) return '';
  return `$${match[1]}${match[2].toUpperCase()}`;
}

function extractFounderName(title, storyText) {
  const fullText = `${title} ${storyText || ''}`;
  for (const re of FOUNDER_NAME_PATTERNS) {
    const m = fullText.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

export async function fetchHNFounders(onProgress) {
  const founders = [];
  const seenCompanies = new Set();

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
        const title = hit.title || '';

        // ── GATE 1: Must be recent (< 1 year old) ──
        const postDate = new Date(hit.created_at);
        if (Date.now() - postDate.getTime() > ONE_YEAR_MS) continue;

        // ── GATE 2: Must be a Show HN (actual launches, not discussions) ──
        if (!/^Show HN/i.test(title)) continue;

        // ── GATE 3: Skip junk titles ──
        if (JUNK_TITLE_PATTERNS.some(re => re.test(title))) continue;

        // ── GATE 4: Must mention NYC/New York somewhere ──
        const fullText = `${title} ${hit.story_text || ''}`;
        if (!/new york|nyc|\bny\b/i.test(fullText)) continue;

        // ── GATE 5: Must extract a real company name ──
        const company = extractCompany(title);
        if (!company) continue;
        if (seenCompanies.has(company.toLowerCase())) continue;
        seenCompanies.add(company.toLowerCase());

        // ── GATE 6: Must have a real founder name from the post content ──
        // HN usernames are NOT names — never use them
        const founderName = extractFounderName(title, hit.story_text);
        if (!founderName) continue;

        const isStealth = title.toLowerCase().includes('stealth');

        founders.push({
          name: founderName,
          role: isStealth ? 'Founder (Stealth)' : 'Founder',
          company,
          description: title.replace(/^Show HN:\s*/i, '').slice(0, 200),
          sector: classifySector(fullText),
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
          confidence_score: 0.45,
        });
      }
    } catch (err) {
      console.warn('HN API error:', err.message);
    }
  }

  return founders;
}
