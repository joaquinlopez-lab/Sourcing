import { Resend } from 'resend';
import Anthropic from '@anthropic-ai/sdk';
import { getRecentFounders, getTopRaisedFounders, getStealthFounders } from '../db/queries.js';

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

// ── Roo Capital outreach template examples (used to guide Claude's style) ──
const OUTREACH_TEMPLATES = `
INITIAL OUTREACH STYLE — Option A (specific product insight):
"[First name] -
Really interested in the concept behind [Company] and your approach to [specific problem]. [1-2 sentences showing you understand their space and have a genuine point of view on it]. Given your background at [prior company/role], we think you have a great foundation to be building here.

My name is [Name] and I am a Principal leading the investment team at Roo Capital, an early-stage, AI-focused venture fund based out of NYC and Miami. We are investing out of our new second fund, have $200M in AUM, and have had the pleasure of backing many vertical AI companies in our six-year history. We invest at the early-stage and have an in-house executive search firm with a proprietary 30K+ person candidate pool that we activate for the benefit of the portfolio.

Would love to learn more, regardless of fundraising, and explore ways our portfolio/network can become your customers. Happy to plan around your availability, so just let me know what works best for you over the coming weeks! And if you're in NYC, let's grab coffee!

Best,
[Name]"

FOLLOW-UP 1 (2-4 days later):
"Hey [Name] — following up on my note below. Let me know if there's any particular dates/times that work best. Happy to move anything around on my end to make it happen!
Best, [Name]"

FOLLOW-UP 2 (2-4 days later):
"Hi [Name] — Happy Monday! Wanted to check in again before your calendar gets too crazy for the week ahead. Anything work to chat this week? Hope you had a great weekend!
Best, [Name]"

PUSHBACK RESPONSE (not raising for a while):
"Hey [Name] — Totally understand you're heads down. That said, we're really excited about what you're building and would love to connect around how our executive search team (Roo Search) can help as you think through your next key hire, org structure, comp benchmarks, and end-to-end senior searches. Happy to kick the conversation out a few months — I'm a big believer in getting to know each other over time so when the time is right, we can move fast.
Best, [Name]"
`;

// ── Draft outreach email via Claude ──
export async function draftOutreachEmail(founder) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });

  const prompt = `You are a Principal at Roo Capital, an early-stage AI-focused venture fund based in NYC and Miami with $200M AUM. You write warm, direct, non-salesy cold outreach emails to founders.

Here are Roo Capital's outreach email templates and style guide to follow closely:
${OUTREACH_TEMPLATES}

Now draft an INITIAL OUTREACH email to this founder:
- Name: ${founder.name}
- Role: ${founder.role || 'Founder'}
- Company: ${founder.company}
${founder.description ? `- About them: ${founder.description}` : ''}
${founder.sector ? `- Sector: ${founder.sector}` : ''}
${founder.raised ? `- Raised: ${founder.raised}` : ''}
${founder.stage ? `- Stage: ${founder.stage}` : ''}

Requirements:
- First line: "Subject: [subject line]"
- Follow the tone and structure of Option A above
- Personalize the first paragraph specifically to their company/background
- Keep body under 150 words total
- Sign off as: Joaquin | Roo Capital
- Plain text only, no markdown, no bullet points

Return ONLY the email (subject + body). Nothing else.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text.trim();
}

// ── Build the daily digest HTML ──
function buildDigestHtml(recent, topRaised, stealth) {
  const founderRow = (f) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a">
        <strong style="color:#f0f0f0">${f.name}</strong><br>
        <span style="color:#999;font-size:12px">${f.role || 'Founder'} @ ${f.company}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#F59E0B;font-size:12px">${f.sector || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#34D399;font-size:12px">${f.raised || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;font-size:11px">
        <a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(f.name)}" style="color:#F07D32">LinkedIn</a>
      </td>
    </tr>`;

  const section = (title, rows) => rows.length === 0 ? '' : `
    <h3 style="color:#F07D32;font-size:14px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:1px">${title}</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:8px;overflow:hidden;border:1px solid #2a2a2a">
      <thead>
        <tr style="background:#0f0f0f">
          <th style="padding:8px 12px;text-align:left;color:#666;font-size:11px;font-weight:600">FOUNDER</th>
          <th style="padding:8px 12px;text-align:left;color:#666;font-size:11px;font-weight:600">SECTOR</th>
          <th style="padding:8px 12px;text-align:left;color:#666;font-size:11px;font-weight:600">RAISED</th>
          <th style="padding:8px 12px;text-align:left;color:#666;font-size:11px;font-weight:600">LINKS</th>
        </tr>
      </thead>
      <tbody>${rows.map(founderRow).join('')}</tbody>
    </table>`;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Roo Capital Daily Digest</title></head>
<body style="background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:20px">
  <div style="max-width:640px;margin:0 auto">
    <div style="background:linear-gradient(135deg,#F07D32,#E8293A);padding:24px 28px;border-radius:12px 12px 0 0">
      <h1 style="margin:0;font-size:20px;color:#fff;font-weight:700">🦘 Roo Capital Weekly Digest</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.8);font-size:13px">${today}</p>
    </div>
    <div style="background:#111;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #2a2a2a;border-top:none">
      ${section('🆕 New This Week', recent)}
      ${section('💰 Top Raises', topRaised)}
      ${section('🥷 Stealth Founders', stealth)}
      ${recent.length === 0 && topRaised.length === 0 && stealth.length === 0
        ? '<p style="color:#666;text-align:center;padding:20px">No new founders to report today.</p>'
        : ''}
      <p style="margin-top:28px;font-size:11px;color:#444;text-align:center">
        Roo Capital Sourcing &nbsp;|&nbsp; Daily Digest
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Send the daily digest ──
export async function sendDigest() {
  const to = process.env.DIGEST_EMAIL_TO;
  if (!to) {
    console.log('[Email] DIGEST_EMAIL_TO not set — skipping digest');
    return;
  }

  const resend = getResend();
  if (!resend) {
    console.log('[Email] RESEND_API_KEY not set — skipping digest');
    return;
  }

  const recent = getRecentFounders(7, 5);
  const topRaised = getTopRaisedFounders(3);
  const stealth = getStealthFounders(3);
  const html = buildDigestHtml(recent, topRaised, stealth);

  const from = process.env.DIGEST_EMAIL_FROM || 'onboarding@resend.dev';
  const subject = `Roo Capital Weekly Digest — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  try {
    const result = await resend.emails.send({ from, to, subject, html });
    console.log(`[Email] Digest sent to ${to} — id: ${result.data?.id}`);
    return result;
  } catch (err) {
    console.error('[Email] Failed to send digest:', err.message);
    throw err;
  }
}

// ── Send an outreach email ──
export async function sendOutreach({ to, subject, body }) {
  const resend = getResend();
  if (!resend) throw new Error('RESEND_API_KEY not set in .env');

  const from = process.env.DIGEST_EMAIL_FROM || 'onboarding@resend.dev';

  const result = await resend.emails.send({
    from,
    to,
    subject,
    text: body,
  });

  return result;
}
