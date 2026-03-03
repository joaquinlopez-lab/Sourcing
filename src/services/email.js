import { Resend } from 'resend';
import Anthropic from '@anthropic-ai/sdk';
import { getRecentOfficials, getHighPopulationOfficials } from '../db/queries.js';

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

// ── Joaquin's outreach email template (Roo Capital intro to GovWell) ──
const OUTREACH_TEMPLATE = `
Hi [Name],

Hope you're doing well.

I'm with Roo Capital, we're an early-stage venture firm backing vertical software and AI-driven infrastructure businesses. We partner closely with founders at the Series A stage and focus on companies building durable, category-defining platforms.

We're currently evaluating a fast-growing company in the local government software space that's modernizing permitting, licensing, inspections, and related municipal workflows through a unified, AI-powered operating system. They're replacing fragmented legacy systems and becoming the daily system of record for cities and counties.

Given your experience in the public sector, we'd love to introduce you directly to the team. We think they're building something special in the space and would value your perspective.

If you're open to it, happy to share a bit more context and coordinate an intro.

Best,
Joaquin
`;

// ── Draft outreach email via Claude ──
export async function draftOutreachEmail(official) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });

  const prompt = `You are drafting a warm outreach email from Joaquin at Roo Capital to a local government official. The goal is to intro them to a portfolio company (GovWell) that modernizes permitting, licensing, inspections, and municipal workflows.

Here is the exact template to follow closely:
${OUTREACH_TEMPLATE}

Now personalize this email for this specific official:
- Name: ${official.name}
- Title: ${official.title || ''}
- Department: ${official.department || ''}
- Municipality: ${official.municipality || ''}
- State: ${official.state || ''}
- Government Level: ${official.government_level || ''}
${official.description ? `- About them: ${official.description}` : ''}
${official.population ? `- Municipality Population: ${official.population.toLocaleString()}` : ''}

Requirements:
- First line: "Subject: [subject line]"
- Personalize the opening to reference their specific municipality and role
- Keep the core message about GovWell intact but tailor it to their department
- Keep body under 150 words total
- Sign off as: Joaquin
- Plain text only, no markdown, no bullet points

Return ONLY the email (subject + body). Nothing else.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text.trim();
}

// ── Build the weekly digest HTML ──
function buildDigestHtml(recent, topPop) {
  const officialRow = (o) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a">
        <strong style="color:#f0f0f0">${o.name}</strong><br>
        <span style="color:#999;font-size:12px">${o.title || ''} — ${o.municipality || ''}${o.state ? ', ' + o.state : ''}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#60A5FA;font-size:12px">${o.department_type || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#34D399;font-size:12px">${o.government_level || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;font-size:11px">
        ${o.linkedin_url ? `<a href="${o.linkedin_url}" style="color:#F07D32">LinkedIn</a>` : '—'}
      </td>
    </tr>`;

  const section = (title, rows) => rows.length === 0 ? '' : `
    <h3 style="color:#F07D32;font-size:14px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:1px">${title}</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:8px;overflow:hidden;border:1px solid #2a2a2a">
      <thead>
        <tr style="background:#0f0f0f">
          <th style="padding:8px 12px;text-align:left;color:#666;font-size:11px;font-weight:600">OFFICIAL</th>
          <th style="padding:8px 12px;text-align:left;color:#666;font-size:11px;font-weight:600">DEPARTMENT</th>
          <th style="padding:8px 12px;text-align:left;color:#666;font-size:11px;font-weight:600">LEVEL</th>
          <th style="padding:8px 12px;text-align:left;color:#666;font-size:11px;font-weight:600">LINKS</th>
        </tr>
      </thead>
      <tbody>${rows.map(officialRow).join('')}</tbody>
    </table>`;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>GovWell Prospect Digest</title></head>
<body style="background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:20px">
  <div style="max-width:640px;margin:0 auto">
    <div style="background:linear-gradient(135deg,#1E40AF,#3B82F6);padding:24px 28px;border-radius:12px 12px 0 0">
      <h1 style="margin:0;font-size:20px;color:#fff;font-weight:700">GovWell Prospect Weekly Digest</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.8);font-size:13px">${today}</p>
    </div>
    <div style="background:#111;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #2a2a2a;border-top:none">
      ${section('New Officials This Week', recent)}
      ${section('Largest Municipalities', topPop)}
      ${recent.length === 0 && topPop.length === 0
        ? '<p style="color:#666;text-align:center;padding:20px">No new officials discovered this week.</p>'
        : ''}
      <p style="margin-top:28px;font-size:11px;color:#444;text-align:center">
        GovWell Prospect Sourcing &nbsp;|&nbsp; Weekly Digest
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Send the weekly digest ──
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

  const recent = getRecentOfficials(7, 10);
  const topPop = getHighPopulationOfficials(5);
  const html = buildDigestHtml(recent, topPop);

  const from = process.env.DIGEST_EMAIL_FROM || 'onboarding@resend.dev';
  const subject = `GovWell Prospect Digest — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

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
