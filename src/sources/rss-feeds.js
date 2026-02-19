import RssParser from 'rss-parser';

const parser = new RssParser();

const FEEDS = [
  { name: 'AlleyWatch',     url: 'https://www.alleywatch.com/feed/' },
  { name: 'TechCrunch NYC', url: 'https://techcrunch.com/tag/new-york/feed/' },
  { name: 'Crunchbase News',url: 'https://news.crunchbase.com/feed/' },
  { name: 'BuiltInNYC',     url: 'https://builtin.com/rss.xml' },
];

function isNYCRelated(text) {
  const lower = (text || '').toLowerCase();
  return /\b(new york|nyc|manhattan|brooklyn)\b/.test(lower);
}

function isStartupFunding(text) {
  const lower = (text || '').toLowerCase();
  return /\b(raises?|funding|seed|series [a-c]|pre.?seed|startup|founded|launch)\b/.test(lower);
}

function classifySector(text) {
  const lower = (text || '').toLowerCase();
  if (/\b(ai|machine learning|ml|deep learning|llm|gpt|neural|nlp|computer vision)\b/.test(lower)) return 'Vertical AI';
  if (/\b(cyber|security|infosec|encryption|zero.?trust|threat)\b/.test(lower)) return 'Cybersecurity';
  if (/\b(health|medical|bio|pharma|clinical|patient|doctor|genomic)\b/.test(lower)) return 'Healthcare Tech';
  return 'SaaS';
}

// Extract real founder name from article text
const FOUNDER_NAME_PATTERNS = [
  /(?:founder|co-founder|ceo|cto)[,:]?\s+([A-Z][a-z]{1,20} [A-Z][a-z]{1,20})/i,
  /([A-Z][a-z]{1,20} [A-Z][a-z]{1,20}),?\s+(?:founder|co-founder|ceo|cto)\b/i,
  /(?:founded by|launched by|started by|created by)\s+([A-Z][a-z]{1,20} [A-Z][a-z]{1,20})/i,
  /([A-Z][a-z]{1,20} [A-Z][a-z]{1,20})(?:'s| has| is building| raised| launched)/i,
];
const REAL_NAME_RE = /^[A-Z][a-z]{1,20} [A-Z][a-z]{1,20}(\s[A-Z][a-z]{1,20}){0,2}$/;

function extractFounderName(text) {
  for (const re of FOUNDER_NAME_PATTERNS) {
    const m = text.match(re);
    if (m && REAL_NAME_RE.test(m[1].trim())) return m[1].trim();
  }
  return null;
}

function extractCompanyFromTitle(title) {
  // "CompanyName raises $XM..." or "CompanyName, a startup..."
  const raiseMatch = title.match(/^([A-Z][A-Za-z0-9\s.]+?)\s+raises?\s/i);
  if (raiseMatch) return raiseMatch[1].trim();

  const commaMatch = title.match(/^([A-Z][A-Za-z0-9\s.]+?),\s/i);
  if (commaMatch) return commaMatch[1].trim();

  return null;
}

function extractRaised(text) {
  const match = (text || '').match(/\$(\d+(?:\.\d+)?)\s*(million|m\b)/i);
  if (match) return `$${match[1]}M`;

  const kMatch = (text || '').match(/\$(\d+(?:\.\d+)?)\s*(k\b|thousand)/i);
  if (kMatch) return `$${kMatch[1]}K`;

  return '';
}

function extractStage(text) {
  const lower = (text || '').toLowerCase();
  if (lower.includes('series a')) return 'Series A';
  if (lower.includes('seed')) return 'Seed';
  if (lower.includes('pre-seed') || lower.includes('pre seed')) return 'Pre-seed';
  return 'Seed';
}

export async function fetchRSSFounders(onProgress) {
  const founders = [];
  const seenTitles = new Set();

  for (const feed of FEEDS) {
    if (onProgress) onProgress(`Reading ${feed.name} RSS feed…`);

    try {
      const parsed = await parser.parseURL(feed.url);

      for (const item of (parsed.items || []).slice(0, 20)) {
        const title = item.title || '';
        const content = `${title} ${item.contentSnippet || ''}`;

        if (seenTitles.has(title)) continue;
        seenTitles.add(title);

        // Only process NYC startup/funding stories
        if (!isNYCRelated(content) || !isStartupFunding(content)) continue;

        const company = extractCompanyFromTitle(title);
        if (!company) continue;

        // Must extract a real founder name — skip if we can't
        const founderName = extractFounderName(content);
        if (!founderName) continue;

        const isStealth = content.toLowerCase().includes('stealth');

        founders.push({
          name: founderName,
          role: 'Founder',
          company,
          description: item.contentSnippet ? item.contentSnippet.slice(0, 200) : title,
          sector: classifySector(content),
          stage: extractStage(content),
          raised: extractRaised(content),
          location: 'New York, NY',
          linkedin_url: null,
          website: item.link || null,
          github_url: null,
          avatar_url: null,
          source: 'rss',
          funded_date: item.isoDate ? item.isoDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
          is_stealth: isStealth,
          confidence_score: 0.4,
        });
      }
    } catch (err) {
      console.warn(`RSS feed error (${feed.name}):`, err.message);
    }
  }

  return founders;
}
