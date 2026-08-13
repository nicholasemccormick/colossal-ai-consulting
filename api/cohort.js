export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, company, email, website, industry, goal } = req.body || {};
    if (!name || !company || !email) return res.status(400).json({ error: 'Missing required fields' });

    const clean = {
      name: String(name).slice(0, 120),
      company: String(company).slice(0, 160),
      email: String(email).slice(0, 200),
      website: website ? String(website).slice(0, 200) : 'Not provided',
      industry: industry ? String(industry).slice(0, 120) : 'Not provided',
      goal: goal ? String(goal).slice(0, 600) : 'Not provided',
      source: 'website-ai-visibility-sprint'
    };

    let stored = false, emailed = false;

    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/cohort_applications`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(clean)
      });
      stored = r.ok;
      if (!r.ok) console.error(await r.text());
    }

    if (process.env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.LEAD_FROM_EMAIL || 'Colossal Website <leads@colossalaiconsulting.com>',
          to: [process.env.LEAD_NOTIFICATION_EMAIL || 'nick@colossalaiconsulting.com'],
          reply_to: clean.email,
          subject: `Sprint Application — ${clean.company}`,
          html: `<h2>New AI Visibility Sprint Application</h2>
<p><strong>Name:</strong> ${esc(clean.name)}</p>
<p><strong>Business:</strong> ${esc(clean.company)}</p>
<p><strong>Email:</strong> ${esc(clean.email)}</p>
<p><strong>Website:</strong> ${esc(clean.website)}</p>
<p><strong>Industry:</strong> ${esc(clean.industry)}</p>
<h3>What they want to be named for</h3>
<p>${esc(clean.goal)}</p>
<p><strong>Source:</strong> AI Visibility Sprint landing page</p>`
        })
      });
      emailed = r.ok;
      if (!r.ok) console.error(await r.text());
    }

    if (!stored && !emailed) return res.status(503).json({ error: 'Lead capture is not configured yet.' });
    return res.status(200).json({ ok: true, stored, emailed });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Unable to submit application' });
  }
}

function esc(v) {
  return String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
