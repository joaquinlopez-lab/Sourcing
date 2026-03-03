import { createLimiter } from '../utils/rate-limiter.js';
import {
  REAL_NAME_RE, GOV_TITLE_KEYWORDS, KNOWN_FEDERAL_FIGURES,
  classifyDepartmentType, classifyPositionType, classifyGovernmentLevel,
  normalizeState, US_STATE_MAP,
} from '../utils/constants.js';

const throttle = createLimiter('exa', { maxRequests: 15, windowMs: 60_000 });

// ── QUERY GROUPS — each targets a specific signal for local gov officials ──

const QUERY_GROUPS = [
  // LinkedIn profiles of government officials
  {
    name: 'linkedin-officials',
    includeDomains: ['linkedin.com/in'],
    numResults: 10,
    type: 'neural',
    maxChars: 800,
    skipDateFilter: true,
    queries: [
      'City Manager at a US municipality. Local government administrator.',
      'Planning Director at city government. Zoning and land use.',
      'Building Department Director at city or county government. Permits.',
      'Chief Information Officer CIO local government municipal technology.',
      'Permitting Director building permits local government.',
      'Code Enforcement Director municipal government compliance.',
      'Public Works Director city government infrastructure operations.',
      'IT Director local government municipal technology systems.',
      'Procurement Director purchasing officer local government.',
      'Community Development Director city government housing economic.',
    ],
  },

  // Municipal government staff directory pages
  {
    name: 'gov-directories',
    numResults: 20,
    type: 'neural',
    maxChars: 3000,
    skipDateFilter: true,
    queries: [
      'city staff directory planning department building department contact information',
      'municipal government directory city manager administrator contact phone email',
      'county government staff directory building permits planning zoning contact',
      'town government directory IT department technology director contact information',
    ],
  },

  // Councils of governments and municipal associations
  {
    name: 'associations',
    excludeDomains: ['wikipedia.org', 'reddit.com'],
    numResults: 10,
    type: 'neural',
    maxChars: 2000,
    skipDateFilter: true,
    queries: [
      'council of governments executive director municipal association staff directory',
      'state municipal league association director local government advocacy',
      'regional planning commission executive director metropolitan planning organization',
    ],
  },

  // GovTech news mentioning officials
  {
    name: 'govtech-news',
    includeDomains: ['govtech.com', 'routefifty.com', 'governing.com', 'americancityandcounty.com'],
    numResults: 15,
    type: 'neural',
    maxChars: 2500,
    queries: [
      'city implements new permitting system software technology director',
      'municipality adopts digital building permit inspection system director',
      'county government modernizes planning and zoning technology official',
      'local government CIO technology transformation digital services',
    ],
  },

  // Professional association directories
  {
    name: 'professional-orgs',
    includeDomains: ['icma.org', 'planning.org'],
    numResults: 10,
    type: 'neural',
    maxChars: 2000,
    skipDateFilter: true,
    queries: [
      'city manager administrator member profile directory',
      'planning director member community development',
      'building official code official member profile directory',
    ],
  },

  // GovTech procurement signals
  {
    name: 'procurement-signals',
    excludeDomains: ['wikipedia.org', 'reddit.com'],
    numResults: 10,
    type: 'neural',
    maxChars: 2500,
    queries: [
      'municipality RFP permitting software building permit online system contact',
      'city government selects implements permit management software platform official',
      'local government digital transformation permits inspections code enforcement director',
    ],
  },
];

// ── Main entry point ──

export async function fetchExaOfficials(onProgress) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    if (onProgress) onProgress('Exa Search skipped (no API key)');
    return [];
  }

  const officials = [];
  const seenUrls = new Set();
  const seenNames = new Set();
  let queryNum = 0;
  const totalQueries = QUERY_GROUPS.reduce((sum, g) => sum + g.queries.length, 0);

  for (const group of QUERY_GROUPS) {
    for (const query of group.queries) {
      queryNum++;
      if (onProgress) onProgress(`Exa ${group.name} (${queryNum}/${totalQueries})...`);
      await throttle();

      try {
        const body = {
          query,
          type: group.type || 'neural',
          num_results: group.numResults || 10,
          contents: { text: { max_characters: group.maxChars || 2000 } },
        };
        if (!group.skipDateFilter) body.startPublishedDate = getSearchStartDate();
        if (group.includeDomains) body.includeDomains = group.includeDomains;
        if (group.excludeDomains) body.excludeDomains = group.excludeDomains;

        const resp = await fetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          console.warn(`[Exa ${group.name}] HTTP ${resp.status}`);
          continue;
        }
        const data = await resp.json();

        for (const result of data.results || []) {
          if (seenUrls.has(result.url)) continue;
          seenUrls.add(result.url);

          const url = result.url || '';
          let parsed = [];

          if (url.includes('linkedin.com/in/')) {
            const p = parseLinkedInGovProfile(result, seenNames);
            if (p) parsed = [p];
          } else if (url.match(/\.gov\b|\.us\b/)) {
            parsed = parseGovDirectoryPage(result, seenNames);
          } else {
            const p = parseGovTechArticle(result, seenNames);
            if (p) parsed = [p];
          }

          for (const official of parsed) {
            seenNames.add(official.name.toLowerCase());
            officials.push(official);
          }
        }
      } catch (err) {
        console.warn(`[Exa ${group.name}] Error:`, err.message);
      }
    }
  }

  if (onProgress) onProgress(`Done - ${officials.length} officials extracted`);
  return officials;
}

function getSearchStartDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 9);
  return d.toISOString();
}

// ── Shared helpers ──

function isBlockedName(name) {
  return KNOWN_FEDERAL_FIGURES.has(name.toLowerCase());
}

function hasGovKeyword(text) {
  const lower = text.toLowerCase();
  return GOV_TITLE_KEYWORDS.some(kw => lower.includes(kw));
}

function extractStateFromText(text) {
  // Try 2-letter state codes
  const codeMatch = text.match(/\b([A-Z]{2})\b/);
  if (codeMatch && US_STATE_MAP.has(codeMatch[1])) return codeMatch[1];
  // Try full state names
  for (const [abbr, fullName] of US_STATE_MAP) {
    if (text.includes(fullName)) return abbr;
  }
  return '';
}

function extractMunicipalityFromText(text) {
  const patterns = [
    /(?:City of|Town of|Village of|Borough of|County of)\s+([A-Z][a-zA-Z\s]+?)(?:\s*[,|.\n])/,
    /([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\s+(?:City|Town|Village|County|Borough)\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0].replace(/[,|.\n]$/, '').trim();
  }
  return '';
}

function extractMunicipalityFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // e.g. "springfieldmo.gov" -> "Springfield"
    const govMatch = hostname.match(/^([a-z]+)(?:city|town|village)?\.(?:gov|us)$/);
    if (govMatch) {
      const name = govMatch[1].replace(/city$|town$|village$/, '');
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    // e.g. "cityofaustin.gov"
    const cityOfMatch = hostname.match(/^cityof([a-z]+)\.(?:gov|us)$/);
    if (cityOfMatch) {
      return 'City of ' + cityOfMatch[1].charAt(0).toUpperCase() + cityOfMatch[1].slice(1);
    }
  } catch {}
  return '';
}

function cleanDescription(text) {
  return text
    .replace(/\[.*?\]/g, '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\|/g, '')
    .replace(/---+/g, '')
    .replace(/Agree & Join LinkedIn.*$/s, '')
    .replace(/By clicking Continue.*$/s, '')
    .replace(/\d+ connections.*?followers/gi, '')
    .replace(/\(https?:\/\/[^)]+\)/g, '')
    .replace(/<web_link>/g, '')
    .replace(/!\[.*?\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250) || '';
}

// ── LinkedIn Government Profile Parser ──

function parseLinkedInGovProfile(result, seenNames) {
  const text = result.text || '';
  const title = result.title || '';
  const url = result.url || '';

  // Extract name from title: "John Smith | City Manager - City of Springfield | LinkedIn"
  let name = null;
  const titleMatch = title.match(/^([A-Z][a-z]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\|/);
  if (titleMatch) name = titleMatch[1].trim();
  if (!name) {
    const textMatch = text.match(/^#\s*([A-Z][a-z]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\n/);
    if (textMatch) name = textMatch[1].trim();
  }
  if (!name || !REAL_NAME_RE.test(name)) return null;
  if (isBlockedName(name)) return null;
  if (seenNames.has(name.toLowerCase())) return null;

  const combined = `${title} ${text}`;

  // Must have a government-related keyword
  if (!hasGovKeyword(combined)) return null;

  // Reject private-sector profiles
  if (/\b(startup|founder|co-founder|venture capital|investor|angel)\b/i.test(combined)) return null;

  // Extract title/role
  let officialTitle = '';
  const roleParts = title.split(/\s*[\|–—-]\s*/);
  if (roleParts.length >= 2) {
    officialTitle = roleParts[1].replace(/\bat\b.*/i, '').trim();
  }

  // Extract municipality
  let municipality = '';
  const atMatch = combined.match(/(?:at|for|with)\s+(City of [A-Z][a-zA-Z\s]+|Town of [A-Z][a-zA-Z\s]+|[A-Z][a-zA-Z\s]+ (?:City|County|Town|Village))/i);
  if (atMatch) municipality = atMatch[1].trim();
  if (!municipality) municipality = extractMunicipalityFromText(combined);

  const state = extractStateFromText(combined);
  const department = officialTitle;

  return {
    name,
    title: officialTitle,
    department,
    municipality,
    state,
    county: '',
    government_level: classifyGovernmentLevel(combined, url),
    department_type: classifyDepartmentType(officialTitle, department),
    position_type: classifyPositionType(officialTitle),
    population: 0,
    description: cleanDescription(text),
    email: null,
    phone: null,
    linkedin_url: url,
    website: null,
    source: 'exa',
    source_url: url,
    discovered_date: new Date().toISOString().slice(0, 10),
    confidence_score: 0.78,
  };
}

// ── Government Directory Page Parser ──

function parseGovDirectoryPage(result, seenNames) {
  const text = result.text || '';
  const url = result.url || '';
  const officials = [];

  const municipality = extractMunicipalityFromText(text) || extractMunicipalityFromUrl(url);
  const state = extractStateFromText(text);

  // Look for patterns like "Name, Title" or "Title: Name" or structured directory entries
  const patterns = [
    /([A-Z][a-z]+ [A-Z][a-z]+),?\s*[-–—]\s*([A-Za-z\s&]+(?:Director|Manager|Chief|Administrator|Officer|Superintendent|Commissioner|Coordinator|Clerk|Engineer|Inspector|Planner))/g,
    /(?:Director|Manager|Chief|Administrator|Officer):\s*([A-Z][a-z]+ [A-Z][a-z]+)/g,
    /([A-Z][a-z]+ [A-Z][a-z]+)\s*\n\s*((?:City|Town|County|Village|Deputy|Assistant)?\s*(?:Manager|Administrator|Director|Chief|Officer|Clerk|Engineer|Planner|Inspector|Commissioner|Superintendent))/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      let name, officialTitle;
      if (re.source.startsWith('(?:Director')) {
        name = m[1].trim();
        // Title is in the surrounding context
        const context = text.slice(Math.max(0, m.index - 50), m.index);
        const titleMatch = context.match(/([\w\s]+(?:Director|Manager|Department))/i);
        officialTitle = titleMatch ? titleMatch[1].trim() : '';
      } else {
        name = m[1].trim();
        officialTitle = m[2].trim();
      }

      if (!REAL_NAME_RE.test(name)) continue;
      if (isBlockedName(name)) continue;
      if (seenNames.has(name.toLowerCase())) continue;
      if (!hasGovKeyword(officialTitle)) continue;

      // Try to extract email nearby
      const nearbyText = text.slice(m.index, m.index + 300);
      const emailMatch = nearbyText.match(/[\w.+-]+@[\w-]+\.(?:gov|us|org)\b/);
      const phoneMatch = nearbyText.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);

      seenNames.add(name.toLowerCase());
      officials.push({
        name,
        title: officialTitle,
        department: officialTitle,
        municipality,
        state,
        county: '',
        government_level: classifyGovernmentLevel(text, url),
        department_type: classifyDepartmentType(officialTitle, ''),
        position_type: classifyPositionType(officialTitle),
        population: 0,
        description: '',
        email: emailMatch ? emailMatch[0] : null,
        phone: phoneMatch ? phoneMatch[0] : null,
        linkedin_url: null,
        website: url,
        source: 'exa',
        source_url: url,
        discovered_date: new Date().toISOString().slice(0, 10),
        confidence_score: 0.70,
      });

      if (officials.length >= 10) break;
    }
  }

  return officials;
}

// ── GovTech Article Parser ──

function parseGovTechArticle(result, seenNames) {
  const text = result.text || '';
  const title = result.title || '';

  // Look for patterns like "said Name, Title of Municipality"
  const patterns = [
    /(?:said|says|according to|explains)\s+([A-Z][a-z]+ [A-Z][a-z]+),?\s+(?:the\s+)?([A-Za-z\s]+(?:director|manager|administrator|chief|officer|CIO|CTO))\s+(?:of|for|at|with)\s+(?:the\s+)?([A-Z][A-Za-z\s,]+?)(?:\.|,|\n)/i,
    /([A-Z][a-z]+ [A-Z][a-z]+),?\s+(?:the\s+)?([A-Za-z\s]+(?:director|manager|administrator|chief|officer|CIO|CTO))\s+(?:of|for|at|with)\s+(?:the\s+)?([A-Z][A-Za-z\s,]+?)(?:\.|,|\n)/i,
  ];

  for (const re of patterns) {
    const m = (`${title} ${text}`).match(re);
    if (!m) continue;

    const name = m[1].trim();
    const officialTitle = m[2].trim();
    const municipality = m[3].trim().replace(/,$/, '');

    if (!REAL_NAME_RE.test(name)) continue;
    if (isBlockedName(name)) continue;
    if (seenNames.has(name.toLowerCase())) continue;
    if (!hasGovKeyword(officialTitle)) continue;

    const state = extractStateFromText(`${municipality} ${text}`);

    return {
      name,
      title: officialTitle,
      department: officialTitle,
      municipality,
      state,
      county: '',
      government_level: classifyGovernmentLevel(text, ''),
      department_type: classifyDepartmentType(officialTitle, ''),
      position_type: classifyPositionType(officialTitle),
      population: 0,
      description: cleanDescription(text),
      email: null,
      phone: null,
      linkedin_url: null,
      website: result.url || null,
      source: 'exa',
      source_url: result.url || null,
      discovered_date: new Date().toISOString().slice(0, 10),
      confidence_score: 0.65,
    };
  }

  return null;
}
