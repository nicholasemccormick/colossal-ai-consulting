export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, company, email, units, score, tier, opportunities, answers } = req.body || {};
    if (!name || !company || !email || typeof score !== 'number' || !tier) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const clean = {
      name: String(name).slice(0, 120),
      company: String(company).slice(0, 160),
      email: String(email).slice(0, 200),
      units: String(units || 'Not provided').slice(0, 80),
      score,
      tier: String(tier).slice(0, 80),
      opportunities: Array.isArray(opportunities) ? opportunities.slice(0, 5) : [],
      answers: Array.isArray(answers) ? answers.slice(0, 20) : [],
      source: 'website-ai-readiness-assessment'
    };

    let stored = false;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const storageResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/assessment_leads`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(clean)
      });
      stored = storageResponse.ok;
      if (!storageResponse.ok) console.error('Supabase error:', await storageResponse.text());
    }

    let emailed = false;
    if (process.env.RESEND_API_KEY) {
      const to = process.env.LEAD_NOTIFICATION_EMAIL || 'nick@colossalai.co';
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.LEAD_FROM_EMAIL || 'Colossal Website <leads@colossalai.co>',
          to: [to],
          reply_to: clean.email,
          subject: `AI Readiness Lead — ${clean.company} (${clean.score}/100)`,
          html: `<h2>New AI Readiness Assessment</h2><p><strong>Name:</strong> ${escapeHtml(clean.name)}</p><p><strong>Company:</strong> ${escapeHtml(clean.company)}</p><p><strong>Email:</strong> ${escapeHtml(clean.email)}</p><p><strong>Portfolio:</strong> ${escapeHtml(clean.units)}</p><p><strong>Score:</strong> ${clean.score}/100</p><p><strong>Tier:</strong> ${escapeHtml(clean.tier)}</p><h3>Top opportunities</h3><ul>${clean.opportunities.map(x => `<li>${escapeHtml(String(x))}</li>`).join('')}</ul>`
        })
      });
      emailed = emailResponse.ok;
      if (!emailResponse.ok) console.error('Resend error:', await emailResponse.text());
    }

    if (!stored && !emailed) {
      return res.status(503).json({ error: 'Lead capture is not configured yet.' });
    }

    return res.status(200).json({ ok: true, stored, emailed });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Unable to submit assessment' });
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
