// Sector classification from keywords in bio/description

const SECTOR_RULES = [
  {
    sector: 'Cybersecurity',
    keywords: /\b(cyber|security|infosec|encryption|zero.?trust|soc|threat|pentest|vulnerability|ransomware|phishing|endpoint|firewall|siem|devsecops|sast|dast|identity.?verif|biodefense)\b/i,
  },
  {
    sector: 'Healthcare Tech',
    keywords: /\b(health|medical|bio|pharma|clinical|patient|doctor|genomic|hospital|ehr|fda|therapeutic|diagnostics|telemedicine|nursing|radiology|pathology|mental.?health|wellness|maternity|fertility|medicare|nutrition|senior.?living)\b/i,
  },
  {
    sector: 'Fintech',
    keywords: /\b(fintech|payment|banking|lending|credit|debit|card|insurance|insurtech|wealth|invest|trading|exchange|blockchain|crypto|stablecoin|defi|treasury|billing|revenue|accounting|tax|payroll|finance|financial)\b/i,
  },
  {
    sector: 'Vertical AI',
    keywords: /\b(ai|artificial intelligence|machine learning|ml|deep learning|llm|gpt|neural|nlp|computer vision|copilot|generative|foundation model|diffusion|transformer|rag|langchain|vector|embedding)\b/i,
  },
  {
    sector: 'Climate Tech',
    keywords: /\b(climate|cleantech|energy|sustainability|carbon|green|renewable|solar|wind|battery|emissions|net.?zero|ev|electric.?vehicle|grid|decarbonization)\b/i,
  },
  {
    sector: 'EdTech',
    keywords: /\b(edtech|education|learning|tutoring|curriculum|school|student|classroom|upskilling|training|e-learning|bootcamp|academy)\b/i,
  },
  {
    sector: 'PropTech',
    keywords: /\b(proptech|real.?estate|property|housing|rent|mortgage|landlord|tenant|home.?buying|listing|leasing|commercial.?real)\b/i,
  },
  {
    sector: 'SaaS',
    keywords: /\b(saas|platform|api|dev.?tool|cloud|infra|b2b|subscription|dashboard|analytics|automation|workflow|collaboration|productivity|crm|erp|observability)\b/i,
  },
];

function classifySector(text) {
  const combined = (text || '').toLowerCase();
  for (const rule of SECTOR_RULES) {
    if (rule.keywords.test(combined)) return rule.sector;
  }
  return 'SaaS'; // default
}

const VALID_STAGES = ['Pre-seed', 'Seed', 'Series A'];

function classifyStage(founder) {
  // If already has a valid stage, keep it
  if (founder.stage && VALID_STAGES.includes(founder.stage)) return founder.stage;

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
  if (clean.endsWith('B')) return parseFloat(clean) * 1_000_000_000;
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
