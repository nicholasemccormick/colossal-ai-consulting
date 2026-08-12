/**
 * AI Practice Lab — API proxy.
 *
 * Deploy to Vercel as /api/practice. Two jobs:
 *   action:"reply" — the simulated student's next turn
 *   action:"score" — rubric scoring of a finished transcript
 *
 * WHY A PROXY AT ALL
 * The Anthropic key lives here and never reaches the browser. Any tutorial that
 * calls an LLM directly from client JavaScript is shipping the key to every
 * visitor, and the first person to open devtools owns your billing.
 *
 * ON ACCEPTING SCENARIO CONTENT FROM THE CLIENT
 * This endpoint takes the persona and rubric in the request rather than looking
 * them up server-side. That is a deliberate prototype trade-off: it is what lets
 * the Studio editor change a student's behaviour and immediately talk to the new
 * version, which is the whole point of the no-code promise. The cost is that a
 * determined stranger could use this as a general-purpose model endpoint, so it
 * is capped hard below — short system prompts, short replies, a turn ceiling and
 * a per-IP hourly limit.
 *
 * In production this flips: scenarios live in the database, the client sends an
 * ID, and the editor writes through an authenticated admin route. Same UX, no
 * open endpoint. Called out here so nobody inherits this pattern by accident.
 */

const MODEL = "claude-sonnet-4-5-20250929";
const MAX_TURNS = 24;             // one "turn" = one learner message
const MAX_REPLY_TOKENS = 320;     // students talk like students, not essays
const MAX_SCORE_TOKENS = 2000;
const MAX_FIELD = 4000;           // per free-text config field
const RATE_LIMIT = 40;            // requests per IP per hour
const RATE_WINDOW_MS = 60 * 60 * 1000;

// Best-effort only. Serverless instances recycle, so this thins abuse rather
// than preventing it. Real rate limiting belongs in a shared store.
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, start: now };
  if (now - rec.start > RATE_WINDOW_MS) {
    rec.n = 0;
    rec.start = now;
  }
  rec.n += 1;
  hits.set(ip, rec);
  if (hits.size > 5000) hits.clear();
  return rec.n > RATE_LIMIT;
}

const clamp = (v, n = MAX_FIELD) => String(v == null ? "" : v).slice(0, n);

function studentSystemPrompt(persona, scenario) {
  return `You are role-playing a STUDENT so that a teacher can practise a difficult conversation. You are not an assistant. Never break character, never mention being an AI, and never coach the teacher.

WHO YOU ARE
Name: ${clamp(persona.name, 80)}
Age / grade: ${clamp(persona.grade, 80)}
In a sentence: ${clamp(persona.summary, 600)}

HOW YOU BEHAVE
${clamp(persona.behavior)}

HOW YOU TALK
${clamp(persona.speech_style, 800)}

WHAT THE TEACHER DOES NOT KNOW YET
${clamp(persona.hidden_context)}
You do not volunteer this. It comes out only if the teacher earns it — by being patient, by asking something specific rather than generic, by not filling every silence. If they rush you or lecture you, you close back up.

THE SITUATION
${clamp(scenario.context)}

HOW TO PLAY IT
- Reply as this student would actually speak. Usually one to three sentences. Real students are brief, especially when uncomfortable.
- Do not be a puzzle that unlocks on the third correct input. Respond to what was actually said.
- If the teacher does something that would genuinely land — names a feeling accurately, offers a real choice, admits something themselves — let it work. Difficulty is not the same as impossibility.
- If the teacher is dismissive, sarcastic, or leads with consequences, react like a ${clamp(persona.grade, 40)} would: shut down, get defensive, go flat.
- Never narrate your own inner state in italics or stage directions. Speech only.
${persona.safety_note ? `\nIMPORTANT LIMIT\n${clamp(persona.safety_note, 1200)}` : ""}`;
}

function scoringPrompt(scenario, rubric, transcript) {
  const criteria = (rubric.criteria || []).map((c, i) => {
    const levels = (c.levels || [])
      .map((l) => `      ${l.score} = ${clamp(l.label, 60)}: ${clamp(l.descriptor, 400)}`)
      .join("\n");
    return `  ${i + 1}. ${clamp(c.name, 120)} (weight ${c.weight || 1})
     ${clamp(c.description, 600)}
${levels}`;
  }).join("\n\n");

  return `You are scoring a teacher's practice conversation with a simulated student against a rubric. Be accurate, not encouraging. Inflated scores make the practice worthless.

THE SCENARIO
${clamp(scenario.context)}

WHAT THE TEACHER WAS TRYING TO DO
${clamp(scenario.objective, 1200)}

THE RUBRIC
${criteria}

THE TRANSCRIPT
${clamp(transcript, 60000)}

RULES
- Every score must be justified by a direct quote from the TEACHER's own words. If you cannot find a quote, the evidence field is "" and the score reflects the absence.
- Do not invent things the teacher did not say. A short conversation earns a low score on criteria it never touched; say that plainly rather than giving credit for intent.
- Score the conversation that happened, not the teacher's potential.
- "next_time" must be a specific alternative line or move, not advice like "build more rapport".
- Feedback speaks to the teacher directly as "you".

Return STRICT JSON only, no markdown fence:
{
  "criteria": [
    {"name": "<exact rubric criterion name>",
     "score": <integer within the rubric's level range>,
     "level_label": "<the label for that score>",
     "evidence": "<direct quote from the teacher, or empty string>",
     "comment": "<two sentences, specific to this conversation>"}
  ],
  "summary": "<three sentences. What the teacher did, what it cost or gained them, where it landed.>",
  "strengths": ["<specific thing they actually did>"],
  "next_time": ["<a concrete alternative move or line>"],
  "one_thing": "<the single highest-leverage change, one sentence>"
}`;
}

async function callAnthropic(key, body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    // Log status only. Upstream error bodies have a habit of echoing request
    // details, and this response goes to the browser.
    console.error("anthropic error", r.status);
    const e = new Error(r.status === 429 ? "Busy — try again in a moment." : "Upstream error.");
    e.status = r.status === 429 ? 429 : 502;
    throw e;
  }
  const data = JSON.parse(text);
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

function safeJson(raw) {
  const cleaned = String(raw).replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const i = cleaned.indexOf("{"), j = cleaned.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try { return JSON.parse(cleaned.slice(i, j + 1)); } catch (_) { /* fall through */ }
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only." });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing its API key." });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Rate limit reached for this hour." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: "Bad JSON." }); }
  }
  body = body || {};

  const { action, persona, scenario, rubric, messages } = body;

  try {
    if (action === "reply") {
      if (!persona || !scenario) return res.status(400).json({ error: "Missing persona or scenario." });
      const turns = (messages || []).filter((m) => m.role === "user");
      if (turns.length > MAX_TURNS) {
        return res.status(400).json({ error: `Practice sessions cap at ${MAX_TURNS} turns.` });
      }
      const trimmed = (messages || []).slice(-40).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: clamp(m.content, 3000),
      }));
      if (!trimmed.length) return res.status(400).json({ error: "No messages." });

      const text = await callAnthropic(key, {
        model: MODEL,
        max_tokens: MAX_REPLY_TOKENS,
        temperature: 0.9,
        system: studentSystemPrompt(persona, scenario),
        messages: trimmed,
      });
      return res.status(200).json({ reply: text.trim() });
    }

    if (action === "score") {
      if (!scenario || !rubric) return res.status(400).json({ error: "Missing scenario or rubric." });
      const transcript = (messages || [])
        .map((m) => `${m.role === "user" ? "TEACHER" : "STUDENT"}: ${clamp(m.content, 3000)}`)
        .join("\n");
      if (!transcript.trim()) return res.status(400).json({ error: "Nothing to score." });

      const raw = await callAnthropic(key, {
        model: MODEL,
        max_tokens: MAX_SCORE_TOKENS,
        temperature: 0,
        messages: [{ role: "user", content: scoringPrompt(scenario, rubric, transcript) }],
      });
      const parsed = safeJson(raw);
      if (!parsed || !Array.isArray(parsed.criteria)) {
        return res.status(502).json({ error: "Could not read the scoring result. Try scoring again." });
      }
      return res.status(200).json({ result: parsed });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
  }
}
