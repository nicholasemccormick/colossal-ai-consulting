export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, practice, email, phone, city, system, missedCalls } = req.body || {};
    if (!name || !practice || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const clean = {
      name: String(name).slice(0, 120),
      practice: String(practice).slice(0, 160),
      email: String(email).slice(0, 200),
      phone: String(phone).slice(0, 40),
      city: city ? String(city).slice(0, 120) : 'Not provided',
      system: system ? String(system).slice(0, 120) : 'Not provided',
      missed_calls: missedCalls ? String(missedCalls).slice(0, 120) : 'Not provided',
      source: 'website-missed-revenue-audit'
    };

    let stored = false, emailed = false;

    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/medspa_audits`, {
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
          subject: `Missed Revenue Audit — ${clean.practice}`,
          html: `<h2>New Missed Revenue Audit request</h2>
<p><strong>Name:</strong> ${esc(clean.name)}</p>
<p><strong>Practice:</strong> ${esc(clean.practice)}</p>
<p><strong>Email:</strong> ${esc(clean.email)}</p>
<p><strong>Phone:</strong> ${esc(clean.phone)}</p>
<p><strong>Location:</strong> ${esc(clean.city)}</p>
<p><strong>Booking system:</strong> ${esc(clean.system)}</p>
<p><strong>Estimated missed calls / week:</strong> ${esc(clean.missed_calls)}</p>
<p><strong>Source:</strong> Missed Revenue Audit form (/medspa)</p>`
        })
      });
      emailed = r.ok;
      if (!r.ok) console.error(await r.text());
    }

    if (!stored && !emailed) return res.status(503).json({ error: 'Lead capture is not configured yet.' });
    return res.status(200).json({ ok: true, stored, emailed });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Unable to submit audit request' });
  }
}

function esc(v) {
  return String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
