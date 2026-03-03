import RssParser from 'rss-parser';
import {
  REAL_NAME_RE,
  classifyDepartmentType, classifyPositionType, classifyGovernmentLevel, normalizeState,
} from '../utils/constants.js';

const parser = new RssParser();

const FEEDS = [
  { name: 'Government Technology', url: 'https://www.govtech.com/rss' },
  { name: 'Route Fifty',          url: 'https://www.route-fifty.com/rss/' },
  { name: 'Governing',            url: 'https://www.governing.com/rss' },
  { name: 'American City & County', url: 'https://www.americancityandcounty.com/feed/' },
  { name: 'Smart Cities Dive',    url: 'https://www.smartcitiesdive.com/feeds/news/' },
  { name: 'GovLoop',              url: 'https://www.govloop.com/feed/' },
];

function isMunicipalRelated(text) {
  const lower = (text || '').toLowerCase();
  return /\b(city|county|municipal|town|village|borough|local government|municipality|permitting|permits|planning|zoning|building|code enforcement)\b/.test(lower);
}

// Extract official name from patterns like "said John Smith, City Manager of Springfield"
const OFFICIAL_NAME_PATTERNS = [
  /(?:said|says|according to|explains)\s+([A-Z][a-z]{1,20} [A-Z][a-z]{1,20}),?\s+(?:the\s+)?(?:city|town|county|village|deputy|assistant|chief|planning|building|public works|IT|procurement|code)/i,
  /([A-Z][a-z]{1,20} [A-Z][a-z]{1,20}),?\s+(?:the\s+)?(?:city manager|city administrator|planning director|building official|IT director|CIO|procurement|public works director|code enforcement)/i,
  /(?:appointed|named|hired|selected)\s+([A-Z][a-z]{1,20} [A-Z][a-z]{1,20})\s+(?:as|to be)\s+(?:the\s+)?(?:new\s+)?(?:city|town|county)/i,
];

function extractOfficialName(text) {
  for (const re of OFFICIAL_NAME_PATTERNS) {
    const m = text.match(re);
    if (m && REAL_NAME_RE.test(m[1].trim())) return m[1].trim();
  }
  return null;
}

function extractTitleFromContext(text, nameIndex) {
  const after = text.slice(nameIndex, nameIndex + 200);
  const titleMatch = after.match(/,?\s+(?:the\s+)?([\w\s]+?(?:Director|Manager|Administrator|Chief|Officer|CIO|CTO|Superintendent|Commissioner|Coordinator|Clerk|Engineer|Planner|Inspector))/i);
  return titleMatch ? titleMatch[1].trim() : '';
}

function extractMunicipality(text) {
  const match = text.match(/(?:City of|Town of|Village of|County of|Borough of)\s+([A-Z][a-zA-Z\s]+?)(?:\s*[,.\n]|$)/);
  return match ? match[0].replace(/[,.\n]$/, '').trim() : '';
}

function extractState(text) {
  const match = text.match(/,\s*([A-Z]{2})\b/);
  return match ? normalizeState(match[1]) : '';
}

export async function fetchRSSOfficials(onProgress) {
  const officials = [];
  const seenTitles = new Set();

  for (const feed of FEEDS) {
    if (onProgress) onProgress(`Reading ${feed.name} RSS feed...`);

    try {
      const parsed = await parser.parseURL(feed.url);

      for (const item of (parsed.items || []).slice(0, 20)) {
        const title = item.title || '';
        const content = `${title} ${item.contentSnippet || ''}`;

        if (seenTitles.has(title)) continue;
        seenTitles.add(title);

        if (!isMunicipalRelated(content)) continue;

        const officialName = extractOfficialName(content);
        if (!officialName) continue;

        const nameIndex = content.indexOf(officialName);
        const officialTitle = extractTitleFromContext(content, nameIndex);
        const municipality = extractMunicipality(content);
        const state = extractState(content);

        officials.push({
          name: officialName,
          title: officialTitle,
          department: officialTitle,
          municipality,
          state,
          county: '',
          government_level: classifyGovernmentLevel(content, ''),
          department_type: classifyDepartmentType(officialTitle, ''),
          position_type: classifyPositionType(officialTitle),
          population: 0,
          description: item.contentSnippet ? item.contentSnippet.slice(0, 250) : title,
          email: null,
          phone: null,
          linkedin_url: null,
          website: item.link || null,
          source: 'rss',
          source_url: item.link || null,
          discovered_date: item.isoDate ? item.isoDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
          confidence_score: 0.4,
        });
      }
    } catch (err) {
      console.warn(`RSS feed error (${feed.name}):`, err.message);
    }
  }

  return officials;
}
