import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { searchFounders, getStats } from '../db/queries.js';

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

function getFounderContext(message) {
  const keywords = extractKeywords(message);
  const results = [];

  // Search for each keyword individually, collect unique founders
  const seenIds = new Set();
  for (const kw of keywords.slice(0, 5)) {
    const { founders } = searchFounders({ search: kw, limit: 10, offset: 0 });
    for (const f of founders) {
      if (!seenIds.has(f.id)) {
        seenIds.add(f.id);
        results.push(f);
      }
    }
  }

  // Also do a full-message search
  const { founders: fullMatch } = searchFounders({ search: message.slice(0, 200), limit: 10, offset: 0 });
  for (const f of fullMatch) {
    if (!seenIds.has(f.id)) {
      seenIds.add(f.id);
      results.push(f);
    }
  }

  return results.slice(0, 15);
}

function buildSystemPrompt(founderContext) {
  const stats = getStats();

  let prompt = `You are a senior VC analyst at Roo Capital, a venture capital firm focused on early-stage NYC startups. You help the investment team evaluate deals, analyze founders, compare opportunities, draft outreach emails, and provide strategic insights.

Your tone is professional, concise, and data-driven. You speak like an experienced investor — direct, analytical, and action-oriented. Use specific numbers and data points when available.

PORTFOLIO CONTEXT:
- You are tracking ${stats.total} founders across NYC's startup ecosystem
- Sectors: ${stats.bySector.map(s => `${s.sector} (${s.count})`).join(', ')}
- Stages: ${stats.byStage.map(s => `${s.stage} (${s.count})`).join(', ')}
- ${stats.stealthCount} stealth-mode companies being tracked
- ${stats.watchlistCount} founders on the watchlist

CAPABILITIES:
- Evaluate founder backgrounds and company potential
- Compare startups within the same sector or stage
- Analyze sector trends and investment thesis fit
- Draft personalized outreach emails to founders
- Assess competitive landscapes
- Recommend next steps for deal pipeline management
- Provide due diligence talking points`;

  if (founderContext.length > 0) {
    prompt += `\n\nRELEVANT FOUNDERS FROM DATABASE:\n`;
    for (const f of founderContext) {
      prompt += `\n- ${f.name} | ${f.role || 'Founder'} at ${f.company}`;
      prompt += ` | Sector: ${f.sector} | Stage: ${f.stage} | Raised: ${f.raised || 'N/A'}`;
      if (f.description) prompt += ` | ${f.description}`;
      if (f.funded_date) prompt += ` | Funded: ${f.funded_date}`;
      if (f.is_stealth) prompt += ` | STEALTH MODE`;
      if (f.website) prompt += ` | Website: ${f.website}`;
      if (f.linkedin_url) prompt += ` | LinkedIn: ${f.linkedin_url}`;
    }
  }

  prompt += `\n\nIMPORTANT: Base your responses on the founder data provided above when discussing specific founders or companies. If asked about founders not in the database, say so clearly. Keep responses concise — aim for 2-4 paragraphs unless the user asks for more detail.`;

  return prompt;
}

router.post('/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Chat unavailable — ANTHROPIC_API_KEY not configured' });
  }

  const { message, history } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Get relevant founder context
  const founderContext = getFounderContext(message);
  const systemPrompt = buildSystemPrompt(founderContext);

  // Build messages array from history
  const chatMessages = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-20)) {
      if (h.role === 'user' || h.role === 'assistant') {
        chatMessages.push({ role: h.role, content: h.content });
      }
    }
  }
  chatMessages.push({ role: 'user', content: message });

  try {
    const client = new Anthropic({ apiKey });

    console.log('[Chat] Sending request to Claude…');
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: chatMessages,
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    console.log('[Chat] Response received (' + text.length + ' chars)');
    res.json({ reply: text });
  } catch (err) {
    console.log('[Chat] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
