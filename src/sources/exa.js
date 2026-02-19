import { createLimiter } from '../utils/rate-limiter.js';

const throttle = createLimiter('exa', { maxRequests: 10, windowMs: 60_000 });

const QUERIES = [
  // 1. Funding rounds — cast wide across stages
  'NYC startup seed funding announcement 2025 2026',
  'New York founder raises pre-seed round',
  'New York City startup Series A funding',

  // 2. Sector-specific — hit verticals we track
  'NYC AI startup founder funding raised',
  'New York fintech startup seed round',
  'NYC healthcare biotech startup founder raises',
  'New York cybersecurity startup funding announcement',
  'NYC climate cleantech startup founder seed',

  // 3. Accelerators & incubators — catch founders entering the ecosystem
  'Y Combinator New York NYC founder startup 2025 2026',
  'Techstars NYC founder startup accelerator batch',
  'NYC startup incubator demo day launch 2025',

  // 4. Talent signals — ex-FAANG & stealth founders
  'New York founder "stealth mode" building startup',
  'NYC "ex-Google" OR "ex-Meta" OR "ex-Stripe" founder new startup',

  // 5. Launch & press coverage — founders getting noticed without funding news
  'NYC startup founder launch Product Hunt 2025 2026',
  'New York startup founder TechCrunch profile interview 2025',
];

// ── Blocklists ──

// Known journalists/writers whose names appear as "author" on funding articles
const JOURNALIST_NAMES = new Set([
  'mary ann azevedo', 'anthony ha', 'connie loizos', 'kate clark',
  'ingrid lunden', 'natasha mascarenhas', 'harri weber', 'sarah perez',
  'manish singh', 'alex wilhelm', 'kirsten korosec', 'amir efrati',
  'eric newcomer', 'elaine watson', 'kirstyn brendlen', 'kristina klaas',
  'chris walker', 'lauren forristal', 'dominic-madori davis', 'marina temkin',
  'kyle wiggers', 'devin coldewey', 'brian heater', 'haje jan kamps',
  'paul sawers', 'ivan mehta', 'zack whittaker', 'carly page',
  'amanda silberling', 'darrell etherington', 'rebecca szkutak',
  'becca szkutak', 'marlize van romburgh', 'jessica mathews',
  'sean o\'kane', 'aria alamalhodaei', 'jacquelyn melinek',
  'kay aloha villamor',
]);

// URL patterns for listicle/aggregator sites (not real funding articles)
const LISTICLE_URL_PATTERNS = [
  /fundraiseinsider\.com/i,
  /growthlist\./i,
  /startupranking\./i,
  /failory\./i,
  /wellfound\.com\/discover/i,
];

// Title patterns that indicate aggregator/listicle content, not a real article
const JUNK_TITLE_PATTERNS = [
  /^\d+\+?\s+(funded|best|top|nyc|new york)/i,   // "100+ Funded NYC Startups"
  /list of funded/i,
  /startup.*(database|directory|list|guide)/i,
  /guide to.*(?:accelerator|incubator|program)/i,
  /what we.ve learned/i,
  /announces? applications/i,
  /series a: a series/i,                          // Meta articles about Series A
];

// A proper person name: "First Last" with 2-4 capitalized words
const REAL_NAME_RE = /^[A-Z][a-z]{1,20} [A-Z][a-z]{1,20}(\s[A-Z][a-z]{1,20}){0,2}$/;

export async function fetchExaFounders(onProgress) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    if (onProgress) onProgress('Exa Search skipped (no API key)');
    return [];
  }

  const founders = [];
  const seenUrls = new Set();
  const seenNames = new Set();

  for (let i = 0; i < QUERIES.length; i++) {
    if (onProgress) onProgress(`Exa Search (${i + 1}/${QUERIES.length})…`);
    await throttle();

    try {
      const resp = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          query: QUERIES[i],
          type: 'auto',
          num_results: 10,
          category: 'news',
          startPublishedDate: getThreeMonthsAgo(),
          contents: { text: { max_characters: 500 } },
        }),
      });

      if (!resp.ok) continue;
      const data = await resp.json();

      for (const result of data.results || []) {
        if (seenUrls.has(result.url)) continue;
        seenUrls.add(result.url);

        const parsed = parseFounderFromResult(result, seenNames);
        if (parsed) {
          seenNames.add(parsed.name.toLowerCase());
          founders.push(parsed);
        }
      }
    } catch (err) {
      console.warn('Exa Search error:', err.message);
    }
  }

  return founders;
}

function getThreeMonthsAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString();
}

function parseFounderFromResult(result, seenNames) {
  const text = result.text || '';
  const title = result.title || '';
  const url = result.url || '';
  const lower = `${title} ${text}`.toLowerCase();

  // ── GATE 1: Must mention NYC / New York ──
  if (!/new york|nyc|\bny\b/i.test(lower)) return null;

  // ── GATE 2: Skip listicle/aggregator URLs ──
  if (LISTICLE_URL_PATTERNS.some(re => re.test(url))) return null;

  // ── GATE 3: Skip junk titles ──
  if (JUNK_TITLE_PATTERNS.some(re => re.test(title))) return null;

  // ── GATE 4: Extract and validate founder name ──
  const name = extractFounderName(result);
  if (!name) return null;
  if (!REAL_NAME_RE.test(name)) return null;
  if (JOURNALIST_NAMES.has(name.toLowerCase())) return null;
  if (seenNames.has(name.toLowerCase())) return null;

  // ── GATE 5: Extract and validate company name ──
  const company = extractCompanyName(title, text);
  if (!company || company === 'Unknown') return null;

  // ── GATE 6: Clean description — reject if it's mostly HTML/nav junk ──
  const cleanDesc = cleanDescription(text);
  if (!cleanDesc || cleanDesc.length < 20) return null;

  const raised = extractRaiseAmount(text + ' ' + title);
  const isStealth = /stealth/i.test(lower);

  return {
    name,
    role: isStealth ? 'Founder (Stealth)' : 'Founder',
    company,
    description: cleanDesc,
    sector: classifySectorFromText(text),
    stage: inferStage(lower),
    raised,
    location: 'New York, NY',
    linkedin_url: null,
    website: url || null,
    github_url: null,
    avatar_url: null,
    source: 'exa',
    funded_date: result.publishedDate
      ? result.publishedDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    is_stealth: isStealth,
    confidence_score: 0.65,
  };
}

function extractFounderName(result) {
  // Try title patterns FIRST — more reliable than author field
  // "Founder Jane Doe raises $5M" or "Jane Doe, founder of Acme"
  const title = result.title || '';
  const text = result.text || '';
  const combined = `${title} ${text}`;

  const patterns = [
    /(?:founder|ceo|co-founder)\s+([A-Z][a-z]+ [A-Z][a-z]+)/i,
    /([A-Z][a-z]+ [A-Z][a-z]+)(?:,?\s+(?:founder|ceo|co-founder))/i,
    /(?:founded by|launched by|started by)\s+([A-Z][a-z]+ [A-Z][a-z]+)/i,
  ];

  for (const re of patterns) {
    const m = combined.match(re);
    if (m && REAL_NAME_RE.test(m[1].trim())) return m[1].trim();
  }

  // Fall back to author field ONLY if it looks like a person AND the article
  // is clearly about a specific startup (not a listicle)
  if (result.author && REAL_NAME_RE.test(result.author.trim())) {
    const authorLower = result.author.trim().toLowerCase();
    // Only use author if NOT a known journalist and the title mentions funding/raises/launches
    if (!JOURNALIST_NAMES.has(authorLower) && /raises?|funding|launch|found/i.test(title)) {
      return result.author.trim();
    }
  }

  return null;
}

function extractCompanyName(title, text) {
  const combined = `${title} ${text}`;

  const patterns = [
    // "CompanyName raises $XM"
    /^([A-Z][A-Za-z0-9.]+(?:\s[A-Z][A-Za-z0-9.]+)?)\s+raises?\b/,
    // "at CompanyName" in context of founding
    /(?:founder|ceo|co-founder)\s+(?:at|of)\s+([A-Z][A-Za-z0-9.]+(?:\s[A-Z][A-Za-z0-9.]+)?)/i,
    // "CompanyName, a NYC startup"
    /([A-Z][A-Za-z0-9.]+(?:\s[A-Z][A-Za-z0-9.]+)?),?\s+a\s+(?:NYC|New York|NY)\s+(?:startup|company)/i,
    // "CompanyName Emerges From Stealth"
    /([A-Z][A-Za-z0-9.]+(?:\s[A-Z][A-Za-z0-9.]+)?)\s+(?:emerges?|launches?|debuts?)/i,
  ];

  for (const re of patterns) {
    const m = combined.match(re);
    if (m) {
      const name = m[1].trim();
      // Reject company names that are clearly not companies
      if (name.length < 2 || name.length > 30) continue;
      if (/^(The|A|An|In|On|At|By|For|To|Is|It|We|He|She)$/i.test(name)) continue;
      return name;
    }
  }

  return '';
}

function cleanDescription(text) {
  return text
    .replace(/\[.*?\]/g, '')          // Remove markdown links [text]
    .replace(/#{1,6}\s*/g, '')        // Remove markdown headers
    .replace(/\|/g, '')               // Remove table pipes
    .replace(/---+/g, '')             // Remove horizontal rules
    .replace(/📅.*$/m, '')            // Remove date stamps
    .replace(/\s+/g, ' ')            // Collapse whitespace
    .trim()
    .slice(0, 200);
}

function extractRaiseAmount(text) {
  const m = text.match(/\$[\d.]+ ?[MmKkBb](?:illion)?/);
  return m ? m[0] : '';
}

function inferStage(lower) {
  if (/series\s*a/i.test(lower)) return 'Series A';
  if (/pre[- ]?seed/i.test(lower)) return 'Pre-seed';
  return 'Seed';
}

function classifySectorFromText(text) {
  const lower = (text || '').toLowerCase();
  if (/\b(ai|machine learning|ml|deep learning|llm|gpt|neural)\b/.test(lower)) return 'Vertical AI';
  if (/\b(fintech|financial|banking|payments|lending)\b/.test(lower)) return 'Fintech';
  if (/\b(cyber|security|infosec|encryption|threat)\b/.test(lower)) return 'Cybersecurity';
  if (/\b(health|medical|bio|pharma|clinical|patient)\b/.test(lower)) return 'Healthcare Tech';
  if (/\b(climate|cleantech|energy|sustainability|carbon|green)\b/.test(lower)) return 'Climate Tech';
  if (/\b(edtech|education|learning platform|tutoring)\b/.test(lower)) return 'EdTech';
  if (/\b(proptech|real estate|property|housing)\b/.test(lower)) return 'PropTech';
  return 'SaaS';
}
