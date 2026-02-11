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

function classifySector(bio) {
  const lower = (bio || '').toLowerCase();
  if (/\b(ai|machine learning|ml|deep learning|llm|gpt|neural|nlp|computer vision)\b/.test(lower)) return 'Vertical AI';
  if (/\b(cyber|security|infosec|encryption|zero.?trust|soc|threat|pentest)\b/.test(lower)) return 'Cybersecurity';
  if (/\b(health|medical|bio|pharma|clinical|patient|doctor|genomic|hospital)\b/.test(lower)) return 'Healthcare Tech';
  if (/\b(saas|platform|api|dev.?tool|cloud|infra|b2b)\b/.test(lower)) return 'SaaS';
  return 'SaaS'; // default
}

function detectRole(bio) {
  const lower = (bio || '').toLowerCase();
  const isStealth = lower.includes('stealth');
  if (isStealth) return 'Founder (Stealth)';
  if (lower.includes('co-founder') && lower.includes('ceo')) return 'Co-Founder & CEO';
  if (lower.includes('co-founder') && lower.includes('cto')) return 'Co-Founder & CTO';
  if (lower.includes('co-founder')) return 'Co-Founder';
  if (lower.includes('ceo')) return 'Founder & CEO';
  if (lower.includes('cto')) return 'Founder & CTO';
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
        } catch { /* skip */ }

        const bio = (profile.bio || '').toLowerCase();
        const isStealth = bio.includes('stealth');
        const isFounder = bio.includes('founder') || bio.includes('ceo') ||
                          bio.includes('co-founder') || bio.includes('cto') || isStealth;

        if (!isFounder) continue;

        const companyRaw = profile.company || '';
        const companyClean = companyRaw.replace(/^@/, '').trim();

        founders.push({
          name: profile.name || user.login,
          role: detectRole(profile.bio),
          company: companyClean || (isStealth ? 'Stealth Startup' : `${user.login} Labs`),
          description: profile.bio || `Technical founder with ${profile.public_repos || 0} open-source projects and ${profile.followers || 0} followers`,
          sector: classifySector(profile.bio),
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
          confidence_score: 0.5,
        });
      }
    } catch (err) {
      console.warn('GitHub API error:', err.message);
    }
  }

  return founders;
}
