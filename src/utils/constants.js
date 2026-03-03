// Shared constants for the GovWell local government official scraper.
// Single source of truth — edit here, not in individual source files.

// "First Last" name pattern — allows Mc/Mac names, apostrophes (O'Brien)
export const REAL_NAME_RE = /^[A-Z][a-z']{1,20} [A-Z][a-zA-Z']{1,20}(\s[A-Z][a-zA-Z']{1,20}){0,2}$/;

// ── Government Title Keywords ──
// Any of these appearing in a title/department string signals a local gov official
export const GOV_TITLE_KEYWORDS = [
  'city manager', 'city administrator', 'town manager', 'town administrator',
  'village manager', 'county administrator', 'county manager',
  'planning director', 'planning manager', 'chief planner', 'planning commissioner',
  'building official', 'building director', 'building inspector',
  'code enforcement', 'code official', 'code compliance',
  'permit', 'permitting', 'licensing',
  'zoning', 'zoning administrator', 'zoning director',
  'public works', 'public works director',
  'cio', 'chief information officer', 'it director', 'technology director',
  'cto', 'chief technology officer', 'gis',
  'procurement', 'purchasing', 'procurement officer',
  'community development', 'community development director',
  'city clerk', 'town clerk', 'county clerk',
  'city engineer', 'county engineer',
  'assistant city manager', 'deputy city manager',
  'executive director', 'municipal', 'government',
  'inspections', 'fire marshal',
  'development services', 'planning and zoning',
  'building and safety', 'neighborhood services',
];

// Patterns that indicate someone is NOT a local government official
export const NON_OFFICIAL_PATTERNS = [
  /\b(private sector|consulting firm|consultant|contractor|vendor|llc|inc|corp)\b/i,
  /\b(journalist|reporter|writer|editor|blogger|correspondent|columnist)\b/i,
  /\b(student|intern|professor|academic|university|college|researcher)\b/i,
  /\b(candidate|running for|campaign|political action)\b/i,
  /\b(former|retired|ex-|emeritus)\b/i,
  /\b(congress|senator|representative|white house|federal agency|pentagon)\b/i,
  /\b(sales rep|marketing|account executive|business development)\b/i,
];

// Known high-profile federal/national figures to exclude
export const KNOWN_FEDERAL_FIGURES = new Set([
  'joe biden', 'kamala harris', 'donald trump', 'mike pence',
  'jd vance', 'nancy pelosi', 'mitch mcconnell', 'chuck schumer',
  'kevin mccarthy', 'mike johnson', 'hakeem jeffries',
]);

// ── US State Data ──

export const US_STATE_ABBREVIATIONS = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

export const US_STATE_MAP = new Map([
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],
  ['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],
  ['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],
  ['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],
  ['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],
  ['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],
  ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],
  ['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],
  ['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],
  ['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],
  ['WI','Wisconsin'],['WY','Wyoming'],['DC','District of Columbia'],
]);

// Reverse map: full name → abbreviation
const STATE_NAME_TO_ABBR = new Map();
for (const [abbr, name] of US_STATE_MAP) STATE_NAME_TO_ABBR.set(name.toLowerCase(), abbr);

export function normalizeState(state) {
  if (!state) return '';
  const trimmed = state.trim();
  const upper = trimmed.toUpperCase();
  if (US_STATE_ABBREVIATIONS.has(upper)) return upper;
  return STATE_NAME_TO_ABBR.get(trimmed.toLowerCase()) || upper.slice(0, 2);
}

// ── Department Type Classification ──

const DEPARTMENT_TYPE_RULES = [
  { type: 'Executive',           keywords: /\b(city manager|city administrator|town manager|county administrator|county manager|assistant city manager|deputy city manager|village manager|town administrator|executive director)\b/i },
  { type: 'Planning',            keywords: /\b(planning|zoning|land use|comprehensive plan|planner)\b/i },
  { type: 'Building',            keywords: /\b(building|construction|structural|building official|building inspector|building and safety)\b/i },
  { type: 'Permitting',          keywords: /\b(permit|permitting|licensing|license|development services)\b/i },
  { type: 'Code Enforcement',    keywords: /\b(code enforcement|code compliance|code official|fire marshal)\b/i },
  { type: 'IT',                  keywords: /\b(information technology|\bIT\b|CIO|CTO|technology|digital|GIS|data)\b/i },
  { type: 'Procurement',         keywords: /\b(procurement|purchasing|acquisition|RFP|bid|contract)\b/i },
  { type: 'Public Works',        keywords: /\b(public works|infrastructure|engineering|utilities|transportation)\b/i },
  { type: 'Community Development', keywords: /\b(community development|housing|neighborhood|economic development)\b/i },
];

export function classifyDepartmentType(title, department) {
  const text = `${title || ''} ${department || ''}`;
  for (const rule of DEPARTMENT_TYPE_RULES) {
    if (rule.keywords.test(text)) return rule.type;
  }
  return 'Other';
}

// ── Position Type Classification ──

const POSITION_TYPE_RULES = [
  { type: 'Director',        keywords: /\b(director)\b/i },
  { type: 'Manager',         keywords: /\b(manager|administrator)\b/i },
  { type: 'Commissioner',    keywords: /\b(commissioner)\b/i },
  { type: 'Chief',           keywords: /\b(chief|CIO|CTO|CFO)\b/i },
  { type: 'Superintendent',  keywords: /\b(superintendent)\b/i },
  { type: 'Coordinator',     keywords: /\b(coordinator)\b/i },
  { type: 'Officer',         keywords: /\b(officer|official)\b/i },
  { type: 'Inspector',       keywords: /\b(inspector)\b/i },
  { type: 'Planner',         keywords: /\b(planner)\b/i },
  { type: 'Engineer',        keywords: /\b(engineer)\b/i },
  { type: 'Clerk',           keywords: /\b(clerk)\b/i },
];

export function classifyPositionType(title) {
  const text = (title || '');
  for (const rule of POSITION_TYPE_RULES) {
    if (rule.keywords.test(text)) return rule.type;
  }
  return 'Other';
}

// ── Government Level Classification ──

export function classifyGovernmentLevel(text, url) {
  const lower = (text || '').toLowerCase();
  const urlLower = (url || '').toLowerCase();
  if (/\b(council of governments|COG|metropolitan planning|regional planning|municipal association|league of cities|conference of)\b/i.test(lower)) return 'Regional';
  if (/\b(association|league)\b/i.test(lower)) return 'Association';
  if (/\b(state of|state government|state agency|state department)\b/i.test(lower)) return 'State';
  if (/\b(county|parish)\b/i.test(lower) || urlLower.includes('county') || urlLower.includes('.co.')) return 'County';
  return 'City';
}
