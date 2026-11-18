// Pia: a small agent. One AI step pulls out ideas, then Pia makes three decisions inside a fixed boundary:
//   1. follow up gaps before asking, 2. propose a task owner, 3. choose a fallback when no meeting time works.
// The boundary is enforced here in code: read-only tools only, at most MAX_STEPS tool steps per run, every run versioned,
// repeat triggers skipped, ambiguous deals stopped. People decide everything that gets written.
// The "model" is a mock (MOCK_MODEL in data.js), so this runs offline with no keys.

const PIA_VERSION = "pia-0.3";
const MAX_STEPS = 10;          // tool steps per run
const REPEAT_WINDOW = 600;     // seconds: same deal and stage within 10 minutes is skipped
const TASK_HOURS = 3;          // hours a proposed set-up task books against the owner
const MIN_FREE = 4;            // an owner needs at least this many free hours this week
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_DATES = { Mon: "23 Nov", Tue: "24 Nov", Wed: "25 Nov", Thu: "26 Nov", Fri: "27 Nov" };
const MODEL_TOOL = "Anthropic, zero retention";

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

// INJECTION FLAG (fixed code): sentences that read like instructions are flagged and treated as call text only.
const INJECTION_PATTERNS = [/ignore (all |your )?(previous|prior) instructions/i, /mark (this|the) pilot as approved/i, /you are now/i, /system prompt/i];
function injectionScan(callIds) {
  const found = [];
  for (const id of callIds) CALLS[id].lines.forEach((l, i) => { if (INJECTION_PATTERNS.some(p => p.test(l.text))) found.push({ call: id, i, text: l.text }); });
  return found;
}

const SUCCESS_WORDS = /success|judge|count it|measure/i;

// ---------- Pia's tools. All read-only. There are no write tools. ----------
const TOOLS = {
  readDeal: { readOnly: true, run: pilot => ({ opportunity: pilot.salesforce.opportunity, owner: pilot.salesforce.owner, closeDate: pilot.salesforce.closeDate, notes: pilot.salesforce.notes || [], openDeals: pilot.salesforce.openDeals || [pilot.salesforce.opportunity] }) },
  readCall: { readOnly: true, run: id => CALLS[id] },
  searchCalls: { readOnly: true, run: ({ terms, calls, success }) => {
    const hits = [];
    for (const c of calls) CALLS[c].lines.forEach((l, i) => {
      const t = l.text.toLowerCase();
      if (terms.some(w => t.includes(w.toLowerCase())) && (!success || SUCCESS_WORDS.test(l.text))) hits.push({ call: c, i, quote: l.text, success: SUCCESS_WORDS.test(l.text) });
    });
    return hits.sort((a, b) => b.success - a.success);
  } },
  getFreeBusy: { readOnly: true, run: cal => cal.internal.map(p => ({ name: p.name, busy: p.busy || [] })) },
  getCapacity: { readOnly: true, run: () => PEOPLE.filter(p => p.hours).map(p => ({ name: p.name, specialities: p.specialities, free: p.hours - p.booked })) }
};
class StepLimit extends Error {}

// ---------- SLOT FINDER (fixed code): 08:00 to 18:00 local for everyone; internal free/busy from Google Calendar. ----------
// Firm calendars are not read, only their working hours.
function fitsHours(p, utc) { const s = utc + p.off; return s >= 8 && s + 1 <= 18; }
function isBusy(p, day, utc) { return (p.busy || []).some(([bd, bh]) => bd === day && bh === utc); }
function proposeSlots(group) {
  const people = [...group.internal, ...group.firm];
  if (!people.length) return [];
  const slots = [];
  for (const d of DAYS) for (let utc = 0; utc < 24; utc++) {
    if (!people.every(p => fitsHours(p, utc))) continue;
    if (group.internal.some(p => isBusy(p, d, utc))) continue;
    slots.push({ day: d, date: DAY_DATES[d], utc, local: people.map(p => ({ name: p.name, city: p.city, time: String(utc + p.off).padStart(2, "0") + ":00" })) });
  }
  const byDay = []; const seen = new Set();
  for (const s of slots) if (!seen.has(s.day)) { seen.add(s.day); byDay.push(s); }
  return byDay.slice(0, 3);
}
// SLOT CHECK (fixed code): every proposed slot must sit inside working hours for every attendee and clear internal free/busy.
function slotCheck(session) {
  for (const s of session.slots) {
    for (const p of [...session.internal, ...session.firm]) {
      if (!fitsHours(p, s.utc)) return { ok: false, why: `${s.day} ${s.date} is outside working hours for ${p.name}` };
    }
    for (const p of session.internal) if (isBusy(p, s.day, s.utc)) return { ok: false, why: `${p.name} is busy ${s.day} ${s.date}` };
  }
  return { ok: true };
}
function regionOf(off) { return off >= 5 ? "Asia" : off <= -3 ? "Americas" : "Europe"; }
function cityList(people) { const c = [...new Set(people.map(p => p.city))]; return c.length > 1 ? c.slice(0, -1).join(", ") + " and " + c.at(-1) : c[0]; }

// DECISION 3 (Pia): no time works for everyone. Choose one fallback and say why.
// Split by region when the region that can't make it has firm attendees and someone from ABC Inc. can run a second session;
// otherwise record the session for that region.
function chooseFallback(cal) {
  const all = [...cal.internal, ...cal.firm];
  const regions = [...new Set(all.map(p => regionOf(p.off)))];
  let best = null;
  for (const R of regions) {
    const inR = p => regionOf(p.off) === R;
    const main = { internal: cal.internal.filter(p => !inR(p)), firm: cal.firm.filter(p => !inR(p)) };
    const mainSlots = proposeSlots(main);
    if (!mainSlots.length) continue;
    const away = all.filter(inR);
    if (!best || away.length < best.away.length) best = { R, main, mainSlots, away };
  }
  if (!best) return null;
  const awayFirm = cal.firm.filter(p => regionOf(p.off) === best.R);
  const hosts = cal.internal.filter(p => regionOf(p.off) !== best.R && proposeSlots({ internal: [p, ...cal.internal.filter(x => regionOf(x.off) === best.R)], firm: awayFirm }).length);
  const second = { internal: [...hosts, ...cal.internal.filter(p => regionOf(p.off) === best.R)], firm: awayFirm };
  const secondSlots = hosts.length ? proposeSlots(second) : [];
  const s1 = { key: "a", label: cityList([...best.main.internal, ...best.main.firm]), internal: best.main.internal, firm: best.main.firm, slots: best.mainSlots };
  if (awayFirm.length && secondSlots.length) {
    const s2 = { key: "b", label: cityList([...second.internal, ...second.firm]), internal: second.internal, firm: second.firm, slots: secondSlots };
    return { kind: "split", sessions: [s1, s2],
      why: `${cityList(best.away)} can't join inside 08:00 to 18:00 with ${cityList(best.main.firm)}. ${awayFirm.map(p => p.name).join(" and ")} from the firm ${awayFirm.length > 1 ? "are" : "is"} there, and ${hosts.map(p => p.name).join(" and ")} can run a second session, so Pia chose two sessions by region. A recording was the other option; it suits people who only need to watch.` };
  }
  return { kind: "record", sessions: [s1],
    why: `${cityList(best.away)} can't join inside working hours and no second session fits, so Pia chose to record the session for ${best.away.map(p => p.name).join(" and ")}.` };
}

// ---------- One run. Returns everything the UI needs; writes nothing. ----------
// opts: trigger, kind ("stage" | "call" | "manual"), now (seconds), history (earlier runs), modelDown, extraCalls, maxSteps
function runPia(pilot, opts = {}) {
  const cap = opts.maxSteps || MAX_STEPS;
  const steps = [];
  const add = (kind, label, detail, status = "ok", tool = "") => steps.push({ kind, label, detail, status, tool });
  const model = MOCK_MODEL[pilot.id] || { ideas: [] };
  const out = { piaVersion: PIA_VERSION, status: "waiting", steps, ideas: [], removed: [], questions: [], proposals: [], schedule: null, skipped: [], read: [],
    toolSteps: 0, maxSteps: cap, at: opts.now || 0, stage: pilot.stage, kind: opts.kind || "manual", trigger: opts.trigger || "Deal reached pilot stage in Salesforce" };
  let used = 0;
  const tool = (name, arg) => {
    if (!TOOLS[name] || !TOOLS[name].readOnly) throw new Error("Pia has no tool called " + name);
    if (used >= cap) throw new StepLimit();
    used++; out.toolSteps = used;
    return TOOLS[name].run(arg);
  };

  add("fixed", "Start", out.trigger, "ok", "Salesforce");

  // Repeat trigger for the same deal and stage within 10 minutes: skip and say why.
  if (out.kind === "stage") {
    const prev = (opts.history || []).filter(h => h.kind === "stage" && h.stage === pilot.stage && h.status !== "skipped" && out.at - h.at < REPEAT_WINDOW).at(-1);
    if (prev) {
      add("fixed", "Repeat trigger skipped", `The same deal and stage started run ${prev.version || 1} ${Math.max(1, Math.round((out.at - prev.at) / 60))} min ago. Runs for the same deal and stage within 10 minutes are skipped. Nothing was read or drafted.`, "stop");
      out.status = "skipped"; out.reason = "Same deal and stage within 10 minutes"; return out;
    }
  }

  const allCalls = [...(pilot.calls || []), ...(opts.extraCalls || [])].filter((c, i, a) => a.indexOf(c) === i);
  const consented = allCalls.filter(c => CALLS[c].consent);
  const skipped = allCalls.filter(c => !CALLS[c].consent);
  out.skipped = skipped;
  add("fixed", "Consent check", skipped.length
    ? `Skipped ${skipped.length} call (${skipped.map(c => CALLS[c].source + ", " + CALLS[c].date).join("; ")}): the firm has not agreed to AI processing`
    : `${consented.length} calls, all with the firm's agreement to recording and AI processing`, skipped.length ? "warn" : "ok");

  if (consented.length === 0) {
    add("fixed", "Nothing to read", "No recorded calls Pia is allowed to read. Nothing was drafted.", "stop");
    out.status = "nothing"; return out;
  }

  const inj = injectionScan(consented);
  out.injection = inj;
  add("fixed", "Injection flag", inj.length
    ? `1 sentence reads like an instruction (${CALLS[inj[0].call].source}, ${CALLS[inj[0].call].lines[inj[0].i].t}). Treated as call text, not as an instruction. Nothing was approved.`
    : "No sentence in the calls reads like an instruction", inj.length ? "warn" : "ok");

  if (opts.modelDown) {
    add("ai", "Read the deal", "Model unavailable (no response after 3 tries). The run stopped cleanly. Nothing was drafted or written. Retry when the model is back.", "error", MODEL_TOOL);
    out.status = "failed"; return out;
  }

  try {
    // 2. Read deal and calls
    const deal = tool("readDeal", pilot);
    add("ai", "Read the deal", `${deal.opportunity}, owner ${deal.owner}. ${deal.notes.length} deal notes.`, "ok", "readDeal · Salesforce");
    if (deal.openDeals.length > 1) {
      add("fixed", "Which deal?", `${pilot.firm} has ${deal.openDeals.length} open deals (${deal.openDeals.join("; ")}). The run stopped as ambiguous and drafted nothing. ${pilot.ae} was asked which deal this pilot is for.`, "stop");
      out.status = "ambiguous"; return out;
    }
    for (const c of consented) { tool("readCall", c); out.read.push(c); add("ai", `Read ${CALLS[c].title.toLowerCase()}`, `${CALLS[c].date}, ${CALLS[c].length}, ${CALLS[c].lines.length} sentences`, "ok", "readCall · " + CALLS[c].source); }

    const ex = LEARNING.examples[pilot.practice];
    if (ex) add("ai", "Use examples", `Used ${ex.n} approved ideas from past ${ex.label} pilots as examples`, "ok", "Learning store");

    // 3. Pull out ideas (the one AI step; mock model sees only read calls)
    const raw = model.ideas.filter(c => !c.needs || consented.includes(c.needs));
    add("ai", "Pull out ideas", `${raw.length} ideas: what the firm asked for, in the firm's words, each with the sentence it came from`, "ok", MODEL_TOOL);

    // 4. Source check
    for (const c of raw) {
      const chk = sourceCheck(c.cite, consented);
      if (!chk.ok) { out.removed.push({ id: c.id, text: c.text, why: chk.why }); continue; }
      const sq = c.successQuote && sourceCheck(c.successQuote, consented).ok ? clone(c.successQuote) : null;
      out.ideas.push({ id: c.id, topic: c.topic, text: c.text, practice: c.practice, cite: clone(c.cite), clarity: c.clarity, successQuote: sq, terms: c.terms,
        followUp: null, status: "open", name: "", mergeInto: null, edited: false, original: c.text });
    }
    add("fixed", "Source check", out.removed.length
      ? `${out.ideas.length} kept. Removed ${out.removed.length}: "${out.removed.map(r => r.text).join('", "')}" (${out.removed.map(r => r.why.toLowerCase()).join("; ")})`
      : `All ${out.ideas.length} ideas point to a real sentence in the calls`, out.removed.length ? "warn" : "ok");

    // 5. Decision 1: follow up gaps before asking
    for (const idea of out.ideas) {
      const vague = idea.clarity === "vague"; if (!vague && idea.successQuote) continue;
      const others = consented.filter(c => c !== idea.cite.call);
      const hits = tool("searchCalls", { terms: idea.terms, calls: others, success: !vague }).filter(h => sourceCheck(h, consented).ok);
      const noteHit = deal.notes.find(n => idea.terms.some(w => n.toLowerCase().includes(w.toLowerCase())) && (vague || SUCCESS_WORDS.test(n)));
      const where = `Looked in ${others.length} other call${others.length === 1 ? "" : "s"} and the deal notes`;
      const gap = vague ? "Not clear what the firm wants" : "No success measure in the same call";
      if (hits.length) {
        const h = hits[0]; const l = lineAt(h);
        idea.followUp = { cite: { call: h.call, i: h.i, quote: h.quote }, from: CALLS[h.call].title, at: l.t };
        if (h.success && !idea.successQuote) idea.successQuote = { call: h.call, i: h.i, quote: h.quote };
        if (vague) idea.clarity = "clear";
        add("decision", `Follow up: ${idea.topic}`, `${gap}. ${where}; found in ${CALLS[h.call].title} (${CALLS[h.call].source}, ${l.t}). Quote attached.`, "ok", "searchCalls");
      } else if (noteHit) {
        idea.followUp = { note: noteHit, from: "Deal notes" };
        if (vague) idea.clarity = "clear";
        add("decision", `Follow up: ${idea.topic}`, `${gap}. ${where}; found in the deal notes.`, "ok", "searchCalls");
      } else {
        out.questions.push({ id: "q-" + idea.id, ideaId: idea.id, cite: clone(idea.cite), asked: false, answer: "",
          text: vague ? `The calls say "${idea.cite.quote}" but not what they would use it for. Which tasks do they want to test?` : `How would the firm judge "${idea.text.toLowerCase()}"? The calls don't say what would count as a success.` });
        add("decision", `Follow up: ${idea.topic}`, `${gap}. ${where}; not found, question added for ${pilot.ae} to ask the firm.`, "warn", "searchCalls");
      }
    }

    // 6. Decision 2: one Legal Engineer task per idea, with a proposed owner
    const caps = tool("getCapacity");
    add("ai", "Check capacity", `${caps.length} Legal Engineers, free hours this week`, "ok", "getCapacity · PilotHQ");
    const free = Object.fromEntries(caps.map(p => [p.name, p.free]));
    for (const idea of out.ideas) {
      if (idea.clarity === "vague") continue; // wait for the firm's answer before proposing work
      const cands = caps.filter(p => p.specialities.includes(idea.practice)).sort((a, b) => free[b.name] - free[a.name]);
      const best = cands[0];
      const task = { id: "task-" + idea.id, ideaId: idea.id, title: `Configure ${idea.topic} for the pilot`, due: "Tue 24 Nov", dueNote: "before kickoff on 25 Nov", hours: TASK_HOURS, practice: idea.practice };
      if (best && free[best.name] >= MIN_FREE) {
        out.proposals.push({ ...task, owner: best.name, freeAt: free[best.name], reason: `${idea.practice}, ${free[best.name]} h free` });
        free[best.name] -= TASK_HOURS;
      } else {
        out.proposals.push({ ...task, owner: null, flag: `No one with ${idea.practice} has time this week`,
          reason: cands.length ? cands.map(c => `${c.name} ${free[c.name]} h free`).join(", ") : `No Legal Engineer lists ${idea.practice}` });
      }
    }
    const flagged = out.proposals.filter(p => !p.owner);
    add("decision", "Propose task owners", out.proposals.map(p => `${p.title}: ${p.owner ? `${p.owner} (${p.reason})` : "no owner"}`).join(". ") + "." +
      (flagged.length ? ` ${flagged.map(f => f.flag).join("; ")}. Flagged to ${ROLES.esm.name}.` : " Every task has an owner with time."), flagged.length ? "warn" : "ok", "Specialities and free hours");

    // 7 and 8. Slots, then Decision 3 if no time works
    if (pilot.calendar) {
      const cal = pilot.calendar;
      tool("getFreeBusy", cal);
      add("ai", "Read free/busy", `${cal.internal.map(p => p.name).join(", ")} (ABC Inc.). Firm calendars are not read, only working hours.`, "ok", "getFreeBusy · Google Calendar");
      const everyone = [...cal.internal, ...cal.firm];
      const direct = proposeSlots(cal);
      if (direct.length) {
        add("fixed", "Slot finder", `${direct.length} slots inside 08:00 to 18:00 for ${cityList(everyone)} and ABC Inc. free/busy`);
        out.schedule = { fallback: null, sessions: [{ key: "a", label: cityList(everyone), internal: cal.internal, firm: cal.firm, slots: direct }] };
      } else {
        add("fixed", "Slot finder", `No time works for ${cityList(everyone)} inside 08:00 to 18:00 local`, "warn");
        const fb = chooseFallback(cal);
        if (fb) {
          out.schedule = { fallback: fb.kind, why: fb.why, sessions: fb.sessions };
          add("decision", "No time works", (fb.kind === "split" ? "Split by region: " + fb.sessions.map(s => `${s.label}, ${s.slots[0].day} ${String(s.slots[0].utc).padStart(2, "0")}:00 London`).join("; ") + ". " : "Record it. ") + fb.why, "ok", "Fallback");
        } else add("decision", "No time works", "No fallback fits. Left for the Account Executive to arrange.", "warn");
      }
      if (out.schedule) {
        const checks = out.schedule.sessions.map(slotCheck);
        const bad = checks.find(c => !c.ok);
        const n = out.schedule.sessions.reduce((a, s) => a + s.slots.length, 0);
        add("fixed", "Slot check", bad ? bad.why : `All ${n} proposed slots are inside working hours and clear on free/busy`, bad ? "blocked" : "ok");
      }
    }
  } catch (e) {
    if (!(e instanceof StepLimit)) throw e;
    add("fixed", "Stopped at the step limit", `Used ${used} of ${cap} tool steps. Stopped cleanly and kept what was drafted: ${out.ideas.length} ideas, ${out.questions.length} questions. Nothing was written.`, "stop");
    out.status = "stopped"; return out;
  }

  add("person", "Waiting for people", `${pilot.les[0]} keeps, merges or drops the ideas. ${ROLES.esm.name} confirms task owners.${out.schedule ? ` ${pilot.ae} picks slots and sends the invite.` : ""} Nothing is written until each person confirms their part.`, "wait");
  return out;
}

// Re-run before Tom confirms: keep people's decisions and edits, add new items, mark what changed.
function mergeRun(prev, next) {
  const changes = [];
  for (const u of next.ideas) {
    const old = prev.ideas.find(x => x.id === u.id);
    if (!old) { u.change = "new"; changes.push(`New idea: ${u.topic}`); continue; }
    Object.assign(u, { status: old.status, name: old.name, mergeInto: old.mergeInto, edited: old.edited });
    if (old.edited) { u.text = old.text; u.change = "kept"; }
    if (!old.followUp && u.followUp) { u.change = "found"; changes.push(`Found in ${u.followUp.from}: ${u.topic}`); }
  }
  for (const q of next.questions) { const oq = prev.questions.find(x => x.id === q.id); if (oq) Object.assign(q, { asked: oq.asked, answer: oq.answer }); }
  for (const q of prev.questions.filter(g => !next.questions.some(x => x.id === g.id))) changes.push(`Question closed: ${(prev.ideas.find(i => i.id === q.ideaId) || {}).topic || q.text.slice(0, 40)}`);
  for (const p of next.proposals) if (!prev.proposals.some(x => x.id === p.id)) changes.push(`New task proposed: ${p.title}`);
  next.changes = changes;
  return next;
}

// What each person's confirmation writes. Each confirm writes only its own piece. Called only from confirm actions.
function confirmWrites(piece, pilot, run, extra = {}) {
  const channel = `#pilot-${pilot.id}-${pilot.firm.split(" ")[0].toLowerCase()}`;
  if (piece === "ideas") {
    const kept = run.ideas.filter(u => u.status === "kept");
    return [
      { target: "Notion", what: `Pilot plan "${pilot.firm}: pilot plan" with ${kept.length} use cases named by ${extra.by || pilot.les[0]} and ${run.questions.length} open questions for the firm` },
      { target: "Slack", what: `Summary posted to ${channel}` }
    ];
  }
  if (piece === "owners") {
    const owned = (extra.tasks || []).filter(t => t.owner);
    return [{ target: "PilotHQ", what: `${owned.length} tasks added to My work for ${[...new Set(owned.map(t => t.owner))].join(", ") || "nobody"}` }];
  }
  if (piece === "assign") return [{ target: "PilotHQ", what: `Task "${extra.title}" added to My work for ${extra.owner}` }];
  return [];
}

function canView(roleKey, pilot) {
  if (roleKey === "esm") return true;
  if (roleKey === "aie") return false; // AI Enablement sees run logs and tests, not pilot content
  return pilot.team.includes(ROLES[roleKey].name);
}
