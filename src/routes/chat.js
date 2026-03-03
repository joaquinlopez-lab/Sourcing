import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { searchOfficials, getStats } from '../db/queries.js';

const router = Router();

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','about','between',
  'through','during','before','after','above','below','and','but','or','not','no',
  'so','if','then','than','too','very','just','also','how','what','which','who',
  'whom','this','that','these','those','it','its','my','your','his','her','our',
  'their','me','him','them','we','you','i','am','all','each','every','any','some',
  'tell','show','give','get','find','help','want','need','please','thanks','thank',
  'hey','hi','hello','know','think','like','make','write','draft','list','compare',
]);

function extractKeywords(message) {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function getOfficialContext(message) {
  const keywords = extractKeywords(message);
  const results = [];
  const seenIds = new Set();

  for (const kw of keywords.slice(0, 5)) {
    const { officials } = searchOfficials({ search: kw, limit: 10, offset: 0 });
    for (const o of officials) {
      if (!seenIds.has(o.id)) { seenIds.add(o.id); results.push(o); }
    }
  }

  const { officials: fullMatch } = searchOfficials({ search: message.slice(0, 200), limit: 10, offset: 0 });
  for (const o of fullMatch) {
    if (!seenIds.has(o.id)) { seenIds.add(o.id); results.push(o); }
  }

  return results.slice(0, 20);
}

function buildSystemPrompt(officialContext) {
  const stats = getStats();

  let prompt = `You are a government affairs and sales intelligence analyst helping Joaquin at Roo Capital source and evaluate local government officials as potential customers for GovWell — a govtech company modernizing permitting, licensing, inspections, and municipal workflows through a unified, AI-powered operating system.

Your tone is professional, concise, and data-driven. You speak like an experienced government affairs specialist — direct, knowledgeable about municipal operations, and action-oriented. Use specific numbers and data points when available. Format responses with markdown — use **bold** for key names/numbers, bullet lists for comparisons, and headers for multi-section answers.

DATABASE CONTEXT:
- Tracking ${stats.total} local government officials across the US
- Departments: ${stats.byDepartment.map(d => `${d.department_type} (${d.count})`).join(', ')}
- Government levels: ${stats.byLevel.map(g => `${g.government_level} (${g.count})`).join(', ')}
- Top states: ${stats.byState.slice(0, 10).map(s => `${s.state} (${s.count})`).join(', ')}
- ${stats.watchlistCount} officials on the watchlist

CAPABILITIES:
- Analyze official backgrounds and municipality needs
- Compare officials within the same department type or region
- Assess which municipalities are best prospects for GovWell
- Draft personalized outreach emails (Roo Capital intro to GovWell)
- Identify patterns in procurement and technology adoption
- Recommend outreach prioritization and next steps
- Provide context on municipal permitting and planning operations

TARGET DEPARTMENTS FOR GOVWELL:
- Planning & Zoning (permitting, land use)
- Building (inspections, code enforcement)
- IT/Technology (digital transformation)
- City Management/Administration (executive decision makers)
- Procurement (RFP issuers)
- Community Development (housing, economic development)`;

  if (officialContext.length > 0) {
    prompt += `\n\nRELEVANT OFFICIALS FROM DATABASE:\n`;
    for (const o of officialContext) {
      prompt += `\n- **${o.name}** | ${o.title || 'Official'} | ${o.municipality || ''}${o.state ? ', ' + o.state : ''}`;
      prompt += ` | Dept: ${o.department_type || 'N/A'} | Level: ${o.government_level || 'N/A'}`;
      if (o.population) prompt += ` | Pop: ${o.population.toLocaleString()}`;
      if (o.description) prompt += ` | ${o.description}`;
      if (o.email) prompt += ` | Email: ${o.email}`;
      if (o.linkedin_url) prompt += ` | LinkedIn: ${o.linkedin_url}`;
      if (o.deal_stage && o.deal_stage !== 'Watching') prompt += ` | Stage: ${o.deal_stage}`;
      if (o.notes) prompt += ` | Notes: ${o.notes}`;
    }
  }

  prompt += `\n\nIMPORTANT: Base responses on the official data above. If an official isn't in the database, say so clearly. Be specific and actionable. For prospect evaluations, consider municipality size, department relevance to GovWell, and whether they're likely in a procurement cycle.`;

  return prompt;
}

function buildMessages(history, message) {
  const chatMessages = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-20)) {
      if (h.role === 'user' || h.role === 'assistant') {
        chatMessages.push({ role: h.role, content: h.content });
      }
    }
  }
  chatMessages.push({ role: 'user', content: message });
  return chatMessages;
}

// ── POST /api/chat/stream — SSE streaming ──
router.post('/chat/stream', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Chat unavailable — ANTHROPIC_API_KEY not configured' });
  }

  const { message, history } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  const officialContext = getOfficialContext(message);
  const systemPrompt = buildSystemPrompt(officialContext);
  const chatMessages = buildMessages(history, message);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: chatMessages,
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
    });

    await stream.finalMessage();
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[Chat] Stream error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── POST /api/chat — non-streaming fallback ──
router.post('/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Chat unavailable — ANTHROPIC_API_KEY not configured' });
  }

  const { message, history } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  const officialContext = getOfficialContext(message);
  const systemPrompt = buildSystemPrompt(officialContext);
  const chatMessages = buildMessages(history, message);

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: chatMessages,
    });

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    res.json({ reply: text });
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
