import { createLimiter } from '../utils/rate-limiter.js';

const throttle = createLimiter('github', { maxRequests: 15, windowMs: 60_000 });

const QUERIES = [
  'location:"New York" founder in:bio',
  'location:NYC founder in:bio',
  'location:"New York" CEO in:bio',
  'location:NYC co-founder in:bio',
  'location:"New York" stealth in:bio',
  'location:NYC stealth in:bio',
  'location:"New York" CTO startup in:bio',
];

// Roles that disqualify someone as an early-stage founder
const DISQUALIFY_PATTERNS = [
  /\b(professor|prof\b|faculty|adjunct|lecturer|postdoc)\b/i,
  /\b(adviser|advisor|consultant|coach|mentor)\b/i,
  /\b(student|intern|junior|associate)\b/i,
  /\b(software engineer|swe|sde|staff engineer|senior engineer)\b/i,
  /\b(freelance|contractor|hired|looking for)\b/i,
];

// Well-known established companies — not early-stage startups
const ESTABLISHED_COMPANIES = new Set([
  'google', 'meta', 'facebook', 'amazon', 'apple', 'microsoft', 'rivian',
  'stripe', 'openai', 'anthropic', 'uber', 'lyft', 'airbnb', 'netflix',
  'lightning ai', 'trail of bits', 'palantir', 'databricks', 'snowflake',
]);

// A real person name: "First Last" with proper capitalization, 2-4 words
const REAL_NAME_RE = /^[A-Z][a-z]{1,20} [A-Z][a-z]{1,20}(\s[A-Z][a-z]{1,20}){0,2}$/;

function classifySector(bio) {
  const lower = (bio || '').toLowerCase();
  if (/\b(ai|machine learning|ml|deep learning|llm|gpt|neural|nlp|computer vision)\b/.test(lower)) return 'Vertical AI';
  if (/\b(fintech|financial|banking|payments|lending)\b/.test(lower)) return 'Fintech';
  if (/\b(cyber|security|infosec|encryption|zero.?trust|soc|threat|pentest)\b/.test(lower)) return 'Cybersecurity';
  if (/\b(health|medical|bio|pharma|clinical|patient|doctor|genomic|hospital)\b/.test(lower)) return 'Healthcare Tech';
  if (/\b(climate|cleantech|energy|sustainability|carbon)\b/.test(lower)) return 'Climate Tech';
  return 'SaaS';
}

function detectRole(bio) {
  const lower = (bio || '').toLowerCase();
  const isStealth = lower.includes('stealth');
  if (lower.includes('co-founder') && lower.includes('ceo')) return 'Co-Founder & CEO';
  if (lower.includes('co-founder') && lower.includes('cto')) return 'Co-Founder & CTO';
  if (lower.includes('co-founder')) return 'Co-Founder';
  if (lower.includes('ceo')) return 'Founder & CEO';
  if (isStealth && (lower.includes('founder') || lower.includes('ceo'))) return 'Founder (Stealth)';
  if (lower.includes('founder')) return 'Founder';
  return 'Founder';
}

export async function fetchGitHubFounders(onProgress) {
  const token = process.env.GITHUB_TOKEN;
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (token) headers['Authorization'] = `token ${token}`;

  const founders = [];
  const seenIds = new Set();

  for (let i = 0; i < QUERIES.length; i++) {
    const query = QUERIES[i];
    if (onProgress) onProgress(`Searching GitHub (${i + 1}/${QUERIES.length})…`);

    await throttle();

    try {
      const url = `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=5&sort=followers`;
      const resp = await fetch(url, { headers });

      if (resp.status === 403 || resp.status === 429) {
        console.warn('GitHub rate limit hit, stopping early');
        break;
      }
      if (!resp.ok) continue;

      const data = await resp.json();

      for (const user of (data.items || [])) {
        if (seenIds.has(user.id)) continue;
        seenIds.add(user.id);

        await throttle();

        let profile = {};
        try {
          const pr = await fetch(`https://api.github.com/users/${user.login}`, { headers });
          if (pr.ok) profile = await pr.json();
        } catch { continue; }

        const bio = profile.bio || '';
        const bioLower = bio.toLowerCase();

        // ── GATE 1: Must have a REAL name (not username) ──
        const name = profile.name;
        if (!name || !REAL_NAME_RE.test(name.trim())) continue;

        // ── GATE 2: Must explicitly be a founder/CEO/co-founder ──
        // "stealth" alone is NOT enough — many employees say "stealth startup"
        const isFounder = bioLower.includes('founder') || bioLower.includes('ceo');
        if (!isFounder) continue;

        // ── GATE 3: Disqualify professors, advisers, engineers, etc. ──
        const disqualified = DISQUALIFY_PATTERNS.some(re => re.test(bio));
        if (disqualified) continue;

        // ── GATE 4: Must have a real company name ──
        const companyRaw = (profile.company || '').replace(/^@/, '').trim();

        // Skip if no company at all
        if (!companyRaw) continue;

        // Skip established companies
        if (ESTABLISHED_COMPANIES.has(companyRaw.toLowerCase())) continue;

        // Skip companies that are just the same as GitHub username
        if (companyRaw.toLowerCase() === user.login.toLowerCase()) continue;

        const isStealth = bioLower.includes('stealth');

        founders.push({
          name: name.trim(),
          role: detectRole(bio),
          company: companyRaw,
          description: bio.slice(0, 200),
          sector: classifySector(bio),
          stage: isStealth ? 'Pre-seed' : 'Seed',
          raised: '',
          location: profile.location || 'New York, NY',
          linkedin_url: null,
          website: profile.blog || null,
          github_url: `https://github.com/${user.login}`,
          avatar_url: user.avatar_url || null,
          source: 'github',
          funded_date: new Date().toISOString().slice(0, 10),
          is_stealth: isStealth,
          confidence_score: 0.55,
        });
      }
    } catch (err) {
      console.warn('GitHub API error:', err.message);
    }
  }

  return founders;
}
