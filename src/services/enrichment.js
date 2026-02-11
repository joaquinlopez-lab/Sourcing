// Sector classification from keywords in bio/description

const SECTOR_RULES = [
  {
    sector: 'Vertical AI',
    keywords: /\b(ai|artificial intelligence|machine learning|ml|deep learning|llm|gpt|neural|nlp|computer vision|copilot|generative|foundation model|diffusion|transformer|rag|langchain|vector|embedding)\b/i,
  },
  {
    sector: 'Cybersecurity',
    keywords: /\b(cyber|security|infosec|encryption|zero.?trust|soc|threat|pentest|vulnerability|ransomware|phishing|endpoint|firewall|siem|devsecops|compliance|sast|dast)\b/i,
  },
  {
    sector: 'Healthcare Tech',
    keywords: /\b(health|medical|bio|pharma|clinical|patient|doctor|genomic|hospital|ehr|fda|therapeutic|diagnostics|telemedicine|nursing|radiology|pathology|mental health|wellness)\b/i,
  },
  {
    sector: 'SaaS',
    keywords: /\b(saas|platform|api|dev.?tool|cloud|infra|b2b|subscription|dashboard|analytics|automation|workflow|collaboration|productivity|crm|erp)\b/i,
  },
];

function classifySector(text) {
  const combined = (text || '').toLowerCase();
  for (const rule of SECTOR_RULES) {
    if (rule.keywords.test(combined)) return rule.sector;
  }
  return 'SaaS'; // default
}

function classifyStage(founder) {
  if (founder.stage && founder.stage !== '') return founder.stage;

  const raised = parseRaisedNum(founder.raised);
  if (raised === 0) return 'Pre-seed';
  if (raised < 2_000_000) return 'Pre-seed';
  if (raised < 8_000_000) return 'Seed';
  return 'Series A';
}

function parseRaisedNum(str) {
  if (!str) return 0;
  const clean = str.replace(/[$,]/g, '');
  if (clean.endsWith('M')) return parseFloat(clean) * 1_000_000;
  if (clean.endsWith('K')) return parseFloat(clean) * 1_000;
  return parseFloat(clean) || 0;
}

export function enrichFounder(founder) {
  const textBlob = `${founder.description || ''} ${founder.company || ''} ${founder.role || ''}`;

  // Auto-classify sector if empty or generic
  if (!founder.sector || founder.sector === '') {
    founder.sector = classifySector(textBlob);
  }

  // Auto-classify stage if empty
  founder.stage = classifyStage(founder);

  // Detect stealth
  if (!founder.is_stealth) {
    const lower = textBlob.toLowerCase();
    founder.is_stealth = lower.includes('stealth');
  }

  // Generate LinkedIn search URL if no real LinkedIn URL
  if (!founder.linkedin_url && founder.name && !founder.name.includes(' Team')) {
    founder.linkedin_url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(founder.name)}`;
  }

  return founder;
}
