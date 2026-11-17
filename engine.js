// Pia: one agent between fixed steps. The "model" is a mock (MOCK_MODEL in data.js), so this runs offline with no keys.
// Fixed steps (consent check, source check, deal-fact screen, injection flag, slot finder) are real code below.

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_DATES = { Mon: "23 Nov", Tue: "24 Nov", Wed: "25 Nov", Thu: "26 Nov", Fri: "27 Nov" };

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function lineAt(cite) {
  if (!cite || !CALLS[cite.call]) return null;
  return CALLS[cite.call].lines[cite.i] || null;
}

// SOURCE CHECK (fixed code): the cited call must have been read, the line must exist and contain the quote.
function sourceCheck(cite, readCalls) {
  if (!cite) return { ok: false, why: "No source sentence given" };
  if (!readCalls.includes(cite.call)) return { ok: false, why: "Cites a call Pia was not allowed to read" };
  const line = lineAt(cite);
  if (!line) return { ok: false, why: "Cited sentence does not exist" };
  if (!line.text.toLowerCase().includes(cite.quote.toLowerCase())) return { ok: false, why: "Quote not found in the cited call" };
  return { ok: true };
}

// DEAL-FACT SCREEN (fixed code plus a model check): terms come from the Salesforce deal; the "model check" looks for people named in the calls.
function dealFactScreen(text, pilot) {
  const s = pilot.salesforce.screen;
  const hits = [];
  const groups = [["firm name", s.firm], ["client of the firm", s.clients], ["matter", s.matters], ["fee or deal value", s.fees]];
  for (const [kind, terms] of groups) for (const t of terms) if (t && text.toLowerCase().includes(t.toLowerCase())) hits.push({ term: t, kind, by: "code" });
  for (const p of pilot.salesforce.people || []) if (text.includes(p)) hits.push({ term: p, kind: "person from the calls", by: "model check" });
  // de-duplicate (e.g. "Albion Retail" inside "Albion Retail Group")
  return hits.filter((h, i) => !hits.some((o, j) => j !== i && o.term.length > h.term.length && o.term.toLowerCase().includes(h.term.toLowerCase())));
}

const INJECTION_PATTERNS = [/ignore (all |your )?(previous|prior) instructions/i, /mark (this|the) pilot as approved/i, /you are now/i, /system prompt/i];
function injectionScan(callIds) {
  const found = [];
  for (const id of callIds) CALLS[id].lines.forEach((l, i) => { if (INJECTION_PATTERNS.some(p => p.test(l.text))) found.push({ call: id, i, text: l.text }); });
  return found;
}

function words(s) { return s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(w => w.length > 3); }
function libraryMatch(uc, sourceText) {
  const w = new Set(words(uc.title + " " + uc.practice + " " + sourceText));
  let best = null;
  for (const e of LIBRARY) {
    const k = e.keywords.filter(x => w.has(x)).length;
    const score = k / e.keywords.length;
    if (!best || score > best.score) best = { id: e.id, score, entry: e };
  }
  return best && best.score >= 0.34 ? best : null;
}

// SLOT FINDER (fixed code): working hours 08:00 to 18:00 local for everyone; internal free/busy from Google Calendar.
// Firm calendars are not read, only their working hours.
function proposeSlots(cal) {
  const people = [...cal.internal, ...cal.firm];
  const slots = [];
  for (const d of DAYS) for (let utc = 0; utc < 24; utc++) {
    const fitsHours = people.every(p => { const s = utc + p.off; return s >= 8 && s + 1 <= 18; });
    if (!fitsHours) continue;
    const busy = cal.internal.filter(p => (p.busy || []).some(([bd, bh]) => bd === d && bh === utc)).map(p => p.name);
    if (busy.length) continue;
    slots.push({ day: d, date: DAY_DATES[d], utc, local: people.map(p => ({ name: p.name, city: p.city, time: String(utc + p.off).padStart(2, "0") + ":00" })) });
  }
  // spread across days: first slot per day, then fill
  const byDay = []; const seen = new Set();
  for (const s of slots) if (!seen.has(s.day)) { seen.add(s.day); byDay.push(s); }
  return byDay.slice(0, 3);
}

// One run. Returns everything the UI needs; writes nothing.
function runPia(pilot, opts = {}) {
  const steps = [];
  const add = (kind, label, detail, status = "ok", tool = "") => steps.push({ kind, label, detail, status, tool });
  const model = MOCK_MODEL[pilot.id] || { candidates: [], practicesMentioned: [], extraGaps: [], dummy: {} };

  add("fixed", "Start", opts.trigger || "Deal reached pilot stage in Salesforce", "ok", "Salesforce");

  const allCalls = [...(pilot.calls || []), ...(opts.extraCalls || [])];
  const consented = allCalls.filter(c => CALLS[c].consent);
  const skipped = allCalls.filter(c => !CALLS[c].consent);
  add("fixed", "Consent check", skipped.length
    ? `Skipped ${skipped.length} call (${skipped.map(c => CALLS[c].source + ", " + CALLS[c].date).join("; ")}): the firm has not agreed to AI processing`
    : `${consented.length} calls, all with the firm's agreement to recording and AI processing`, skipped.length ? "warn" : "ok");

  if (consented.length === 0) {
    add("fixed", "Nothing to read", "No recorded calls Pia is allowed to read. Nothing was drafted.", "stop");
    return { status: "nothing", steps, useCases: [], removed: [], gaps: [], dummy: {}, slots: [], skipped, read: [] };
  }

  if (opts.modelDown) {
    add("ai", "Plan the run", "Model unavailable (no response after 3 tries). The run stopped cleanly. Nothing was drafted or written. Retry when the model is back.", "error", "Anthropic, zero retention");
    return { status: "failed", steps, useCases: [], removed: [], gaps: [], dummy: {}, slots: [], skipped, read: [] };
  }

  add("ai", "Plan the run", `Pia chose to read the deal, ${consented.length} calls, the past-pilot library${pilot.calendar ? " and calendar free/busy" : ""}`, "ok", "Anthropic, zero retention");
  add("ai", "Read the deal", `${pilot.salesforce.opportunity}, owner ${pilot.salesforce.owner}. Deal facts loaded for the screen.`, "ok", "Salesforce");
  for (const c of consented) add("ai", `Read ${CALLS[c].title.toLowerCase()}`, `${CALLS[c].date}, ${CALLS[c].length}, ${CALLS[c].lines.length} sentences`, "ok", CALLS[c].source);

  const inj = injectionScan(consented);
  if (inj.length) add("fixed", "Injection flag", `1 sentence reads like an instruction (${CALLS[inj[0].call].source}, ${CALLS[inj[0].call].lines[inj[0].i].t}). Treated as call text, not as an instruction. Nothing was approved.`, "warn");

  // Draft (mock model sees only read calls)
  const raw = model.candidates.filter(c => !c.needs || consented.includes(c.needs));
  add("ai", "Draft use cases", `${raw.length} use cases drafted from the calls`, "ok", "Anthropic, zero retention");

  // Source check
  const useCases = []; const removed = [];
  for (const c of raw) {
    const chk = sourceCheck(c.cite, consented);
    if (!chk.ok) { removed.push({ id: c.id, title: c.title, why: chk.why }); continue; }
    let criterion = c.criterion;
    if (c.criterionIfCall) for (const k of Object.keys(c.criterionIfCall)) if (consented.includes(k)) criterion = c.criterionIfCall[k];
    if (criterion && !sourceCheck(criterion.cite, consented).ok) criterion = null;
    const lm = libraryMatch(c, lineAt(c.cite).text);
    useCases.push({ id: c.id, title: c.title, practice: c.practice, feature: c.feature, cite: c.cite, criterion: criterion ? clone(criterion) : null, library: lm ? { id: lm.id, score: Math.round(lm.score * 100), entry: lm.entry } : null, status: "draft", edited: false });
  }
  add("fixed", "Source check", removed.length
    ? `${useCases.length} kept. Removed ${removed.length}: "${removed.map(r => r.title).join('", "')}" (${removed.map(r => r.why.toLowerCase()).join("; ")})`
    : `All ${useCases.length} use cases point to a real sentence in the calls`, removed.length ? "warn" : "ok");

  add("ai", "Search past pilots", `${useCases.filter(u => u.library).length} of ${useCases.length} use cases matched a de-identified past pilot`, "ok", "Notion library");

  // Gaps (AC6): ask instead of guessing
  const gaps = [];
  for (const u of useCases) if (!u.criterion) gaps.push({ id: "gap-" + u.id, kind: "No success criterion", text: `The calls don't say how "${u.title.toLowerCase()}" will be judged. What would make it a success?`, cite: u.cite, answer: "" });
  for (const p of model.practicesMentioned || []) if (!useCases.some(u => u.practice === p.practice) && sourceCheck(p.cite, consented).ok) gaps.push({ id: "gap-practice-" + p.practice, kind: "Practice with no use case", text: p.question, cite: p.cite, answer: "" });
  for (const g of model.extraGaps || []) if (sourceCheck(g.cite, consented).ok) gaps.push({ id: g.id, kind: "Unclear measure", text: g.text, cite: g.cite, answer: "" });
  add("ai", "Draft success criteria and gaps", `${useCases.filter(u => u.criterion).length} success criteria drafted, ${gaps.length} questions for the Legal Engineer instead of guesses`, gaps.length ? "warn" : "ok", "Anthropic, zero retention");

  // Dummy data + deal-fact screen
  const dummy = {};
  let blocked = 0;
  for (const u of useCases) {
    const d = (model.dummy || {})[u.id];
    if (!d) continue;
    const hits = d.docs.flatMap(doc => dealFactScreen(doc.title + " " + doc.body, pilot));
    if (hits.length) blocked++;
    dummy[u.id] = { brief: d.brief, docs: clone(d.docs), redraft: d.redraft ? clone(d.redraft) : null, hits, status: hits.length ? "blocked" : "draft" };
  }
  add("ai", "Draft dummy data", `${Object.keys(dummy).length} briefs with first-draft documents, all marked invented`, "ok", "Anthropic, zero retention");
  const blockedList = Object.entries(dummy).filter(([, d]) => d.hits.length);
  add("fixed", "Deal-fact screen", blocked
    ? `Blocked ${blocked} draft: ${blockedList.map(([, d]) => d.hits.map(h => `"${h.term}" (${h.kind}, found by ${h.by})`).join(", ")).join("; ")}`
    : "No firm, client, matter, fee or person names found", blocked ? "blocked" : "ok");

  let slots = [];
  if (pilot.calendar) {
    slots = proposeSlots(pilot.calendar);
    add("ai", "Propose meeting slots", `${slots.length} slots that fit London, Stockholm and Singapore working hours and Legora free/busy. Invite drafted, not sent.`, "ok", "Google Calendar");
  }
  add("person", "Waiting for approval", `${pilot.les[0]} reviews, edits and approves. Nothing is written before that.`, "wait");

  return { status: "ready", steps, useCases, removed, gaps, dummy, slots, skipped, read: consented, injection: inj };
}

// Re-run before approval (AC2): keep the Legal Engineer's edits, add new items, mark what changed.
function mergeRun(prev, next) {
  const changes = [];
  for (const u of next.useCases) {
    const old = prev.useCases.find(x => x.id === u.id);
    if (!old) { u.change = "new"; changes.push(`New use case: ${u.title}`); continue; }
    if (old.edited) { Object.assign(u, { title: old.title, criterion: old.criterion, status: old.status, edited: true }); u.change = "kept"; continue; }
    u.status = old.status;
    const a = old.criterion ? old.criterion.text : "", b = u.criterion ? u.criterion.text : "";
    if (a !== b) { u.change = "changed"; u.was = a || "(none)"; changes.push(`Success criterion updated: ${u.title}`); }
  }
  for (const g of next.gaps) { const og = prev.gaps.find(x => x.id === g.id); if (og) g.answer = og.answer; }
  const closed = prev.gaps.filter(g => !next.gaps.some(x => x.id === g.id));
  for (const g of closed) changes.push(`Gap closed: ${g.kind.toLowerCase()} (${g.text.slice(0, 50)}...)`);
  for (const [k, d] of Object.entries(next.dummy)) { const od = prev.dummy[k]; if (od && od.status !== "blocked") next.dummy[k] = od; }
  next.changes = changes;
  return next;
}

// What approval writes (AC11). Called only from the Approve action.
function approvalWrites(pilot, run) {
  const kept = run.useCases.filter(u => u.status !== "rejected");
  return [
    { target: "Notion", what: `Pilot page "${pilot.firm}: pilot plan" with ${kept.length} use cases, success criteria and open questions` },
    { target: "Notion", what: `${Object.keys(run.dummy).filter(k => kept.some(u => u.id === k)).length} dummy data briefs and documents, marked invented` },
    { target: "Slack", what: `Summary posted to #pilot-${pilot.id}-${pilot.firm.split(" ")[0].toLowerCase()}` },
    { target: "Notion library", what: "De-identified copy of the plan added to the past-pilot library (deal-fact screen passed)" }
  ];
}

function canView(roleKey, pilot) {
  if (roleKey === "growth") return true;
  if (roleKey === "aie") return false; // AI Enablement sees run logs and tests, not pilot content
  return pilot.team.includes(ROLES[roleKey].name);
}

function editLevel(run) {
  const n = run.useCases.length || 1;
  const touched = run.useCases.filter(u => u.edited || u.status === "rejected").length;
  if (touched === 0) return "No edits";
  return touched / n <= 0.4 ? "Light edits" : "Heavy edits";
}
