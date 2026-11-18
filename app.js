// PilotHQ UI. Plain JavaScript, no build step. State lives in memory. Hash routing: #/work, #/pilots/hv/ideas, ...

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const jq = s => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const BASE = Date.UTC(2026, 10, 18, 9, 41, 0);
const PERSON = Object.fromEntries(PEOPLE.map(p => [p.name, p]));
const NAV = {
  le: [["work", "My work"], ["approvals", "Approvals"], ["pilots", "Pilots"], ["people", "People"]],
  ae: [["pilots", "My pilots"], ["work", "My work"], ["people", "People"]],
  esm: [["pilots", "Portfolio"], ["work", "My work"], ["approvals", "Approvals"], ["people", "People"]],
  aie: [["quality", "Quality"], ["people", "People"]],
  out: [["work", "My work"], ["pilots", "Pilots"], ["people", "People"]]
};
const LANDING = { le: "work", ae: "pilots", esm: "pilots", aie: "quality", out: "work" };
const PILOT_TABS = [["overview", "Overview"], ["progress", "Progress"], ["ideas", "Ideas"], ["gaps", "Gaps"], ["schedule", "Schedule"], ["team", "Team"], ["activity", "Activity"]];
const PIA_ACTOR = "Pia (service account, deal team only)";
const LATER = ["Past-pilot library", "Firm-side tasks and contacts", "Draft success criteria", "Draft dummy data", "Pia sends invites itself"];
let S;

function freshState() {
  return {
    role: "le", r: [], pilots: clone(PILOTS), runs: {}, skips: [], audit: [], clock: 0,
    modelDown: false, g2Landed: false, anim: null, panel: null, modal: null, toasts: [],
    testRun: null, acResults: null, demoOpen: true, priority: {}, done: {}, extraTasks: [], apDone: {}, apFilter: "All", capAdd: {},
    piaOpen: true, navOpen: false, q: "", actFilter: "All", qtab: "checks",
    conf: {}, pick: {}, assigned: {}, slot: {}, sent: {}, labels: [], writes: [], editing: null
  };
}
function stamp() { S.clock += 3 + Math.floor(Math.random() * 6); return new Date(BASE + S.clock * 1000).toISOString().slice(11, 19); }
function log(pid, actor, type, text) { S.audit.push({ at: stamp(), pid, actor, type, text }); }
function pilot(id) { return S.pilots.find(p => p.id === id); }
function run(pid) { const r = S.runs[pid]; return r ? r[r.length - 1] : null; }
function ready(pid) { const r = run(pid); return !!(r && r.status === "waiting" && !(S.anim && S.anim.pid === pid)); }
function conf(pid) { return S.conf[pid] || (S.conf[pid] = {}); }
function me() { return ROLES[S.role].name; }
function toast(msg, kind = "", undo = null) { const id = Math.random(); S.toasts.push({ id, msg, kind, undo }); setTimeout(() => { S.toasts = S.toasts.filter(t => t.id !== id); render(); }, 4500); }
function go(h) { if (location.hash === "#/" + h) route(); else location.hash = "#/" + h; }
function label(pid, kind, detail) { S.labels.push({ at: "18 Nov", pilot: pilot(pid).firm, kind, detail, by: me() }); }
function write(pid, piece, ws) { for (const w of ws) { S.writes.push({ ...w, pid, piece, by: me() }); log(pid, "PilotHQ (after " + me() + " confirmed)", "write", `${w.target}: ${w.what}`); } }

function stepAudit(pid, st) {
  const type = st.label === "Start" ? "start" : st.kind === "fixed" ? "check" : st.kind === "decision" ? "decision" : st.kind === "ai" ? (st.label === "Pull out ideas" ? "draft" : "read") : "waiting";
  const actor = st.kind === "fixed" ? "PilotHQ checks (code)" : st.kind === "person" ? "PilotHQ" : PIA_ACTOR;
  return { actor, type, text: `${st.label}: ${st.detail}` };
}

function seed() {
  for (const id of ["nh", "bw"]) {
    const r = runPia(pilot(id), { trigger: "Deal reached pilot stage in Salesforce", kind: "stage", now: S.clock }); r.version = 1; S.runs[id] = [r];
    for (const st of r.steps) { const a = stepAudit(id, st); log(id, a.actor, a.type, a.text); }
  }
  S.clock += 900;
}

// ---------- derived data ----------
function tasks() { return [...TASKS, ...S.extraTasks].filter(t => !t.after || (t.after === "run" ? (run(t.pid) && run(t.pid).status === "waiting") : conf(t.pid).ideas)); }
function capacity(pid) { const c = CAPACITY[pid]; const add = S.capAdd[pid] || {}; return c.need.map((n, w) => ({ need: n, staffed: c.staffed[w] + (add[w] || 0), driver: c.driver[w] })); }
function stageOf(pid) { if (PROGRESS[pid].current != null && pid !== "hv") return PROGRESS[pid].current; return conf(pid).ideas ? 3 : run(pid) ? 1 : 0; }
function riskOf(p) {
  const c0 = capacity(p.id)[0]; const short = c0.need - c0.staffed;
  if (p.id === "cr") return short > 0 ? ["High", "Short of Legal Engineer hours; 3 criteria not agreed"] : ["Medium", "3 success criteria not agreed"];
  if (p.id === "lh") return ["Low", ""];
  const r = run(p.id);
  if (r && r.status === "nothing") return ["Medium", "No recorded calls yet"];
  const fl = openFlags(p.id).length;
  if (fl) return ["Medium", `${fl} task${fl > 1 ? "s" : ""} with no owner`];
  if (short > 0) return ["Medium", `Short of ${short} Legal Engineer hours this week`];
  return ["Low", ""];
}
function nextStep(p) {
  if (p.id === "lh") return "Week 4 usage review, 26 Nov";
  if (p.id === "cr") return "Run the overdue first training";
  const r = run(p.id);
  if (S.anim && S.anim.pid === p.id) return "Pia is reading the calls";
  if (!r) return "Waiting for pilot stage in Salesforce";
  if (r.status === "nothing") return "Book and record a discovery call";
  if (r.status === "failed") return "Retry Pia's run";
  if (r.status === "ambiguous") return "Account Executive to say which deal";
  if (r.status === "stopped") return "Re-run Pia";
  if (!conf(p.id).ideas) return `${p.les[0]} to keep, merge or drop the ideas`;
  if (!conf(p.id).owners) return "Confirm task owners";
  return "Send the first training invites";
}
function ownerOf(pid, pr) { const pk = (S.pick[pid] || {})[pr.id]; return pk !== undefined ? pk : pr.owner; }
function liveProposals(pid) {
  const r = run(pid); if (!r) return [];
  return r.proposals.filter(pr => { const i = r.ideas.find(x => x.id === pr.ideaId); return !i || !["dropped", "merged"].includes(i.status); });
}
function openFlags(pid) {
  if (!conf(pid).owners) return [];
  return liveProposals(pid).filter(pr => !pr.owner && !(S.pick[pid] || {})[pr.id] && !(S.assigned[pid] || {})[pr.id]);
}
function approvals() {
  const items = [];
  for (const p of S.pilots) {
    const r = run(p.id); if (!ready(p.id) || !canView(S.role, p)) continue;
    if (S.role === "le" && p.les[0] === me() && !conf(p.id).ideas) items.push({ id: "ideas-" + p.id, pia: true, type: "Ideas", pid: p.id, text: r.changes && r.changes.length ? `Pia updated the ideas after the follow-up call: ${r.changes.length} changes` : `${r.ideas.length} ideas from the calls, ${r.questions.length} questions for the firm. Keep, merge or drop each one.`, age: "Just now", review: `pilots/${p.id}/ideas` });
    if (S.role === "esm" && !conf(p.id).owners && r.proposals.length) items.push({ id: "own-" + p.id, pia: true, kind: "owners", type: "Task owners", pid: p.id, text: `Pia proposed owners for ${r.proposals.length} tasks${r.proposals.some(x => !x.owner) ? `, ${r.proposals.filter(x => !x.owner).length} with no owner` : ""}`, age: p.id === "hv" ? "Just now" : "1 day" });
    if (S.role === "esm") for (const f of openFlags(p.id)) items.push({ id: "flag-" + f.id, pia: true, kind: "flag", type: "No owner", pid: p.id, prop: f, text: `${f.title}: ${f.flag}`, age: "Just now" });
  }
  if (S.role === "esm") items.push({ id: "staff-cr", type: "Staffing", pid: "cr", text: "Castellan & Rowe is short 12 Legal Engineer hours this week. Add Ravi Menon for 12 h.", age: "1 day", apply: () => addCap("cr", 0, 12, "Ravi Menon") });
  return items.filter(i => !S.apDone[i.id]);
}
function addCap(pid, w, h, who, noTask) {
  S.capAdd[pid] = S.capAdd[pid] || {}; S.capAdd[pid][w] = (S.capAdd[pid][w] || 0) + h;
  if (!noTask) S.extraTasks.push({ id: "x" + Math.random().toString(36).slice(2, 7), pid, stage: stageOf(pid), title: `Join ${pilot(pid).firm} for ${h} h: ${CAPACITY[pid].driver[w].toLowerCase()}`, owner: who, due: "Week of " + WEEKS[w], dueDay: 5 + w * 7, assignedBy: me() });
  const p = pilot(pid); if (!p.team.includes(who)) p.team.push(who);
  log(pid, me(), "confirm", `Assigned ${who} for ${h} h in the week of ${WEEKS[w]}`);
}
function visiblePeople() { return PEOPLE.filter(p => p.org === "ABC Inc." || canView(S.role, pilot(p.org))); }
function lesFree() { return PEOPLE.filter(x => x.hours).map(x => ({ ...x, free: x.hours - x.booked })).sort((a, b) => b.free - a.free); }

// ---------- people's confirmations (shared by the UI and the acceptance checks) ----------
function ideasProblem(r) {
  const open = r.ideas.filter(i => i.status === "open").length;
  if (open) return `${open} idea${open > 1 ? "s" : ""} still to decide`;
  if (r.ideas.some(i => i.status === "kept" && !i.name.trim())) return "Name every kept use case";
  if (r.ideas.some(i => i.status === "merged" && (r.ideas.find(x => x.id === i.mergeInto) || {}).status !== "kept")) return "Merge into a kept idea";
  if (!r.ideas.some(i => i.status === "kept")) return "Keep at least one idea";
  return "";
}
function confirmIdeasCore(pid) {
  const p = pilot(pid); const r = run(pid);
  for (const i of r.ideas) {
    if (i.status === "kept") label(pid, i.edited || i.name !== i.original ? "Idea edited" : "Idea kept", `${i.topic}: kept as "${i.name}"`);
    if (i.status === "merged") label(pid, "Idea merged", `${i.topic} merged into ${(r.ideas.find(x => x.id === i.mergeInto) || {}).topic}`);
    if (i.status === "dropped") label(pid, "Idea dropped", i.topic);
  }
  const ws = confirmWrites("ideas", p, r, { by: me() });
  conf(pid).ideas = { by: me(), writes: ws };
  log(pid, me(), "confirm", `Confirmed the ideas: ${r.ideas.filter(i => i.status === "kept").length} kept, ${r.ideas.filter(i => i.status === "merged").length} merged, ${r.ideas.filter(i => i.status === "dropped").length} dropped`);
  write(pid, "ideas", ws);
  log(pid, "Slack", "write", slackText(pid));
  S.done.t1 = true;
}
function confirmOwnersCore(pid) {
  const p = pilot(pid); const list = liveProposals(pid).map(pr => ({ pr, owner: ownerOf(pid, pr) }));
  const made = [];
  for (const { pr, owner } of list) {
    if (pr.owner && owner === pr.owner) label(pid, "Owner accepted", `${pr.title}: ${owner}`);
    else if (owner && pr.owner) label(pid, "Owner changed", `${pr.title}: ${pr.owner} to ${owner}`);
    else if (owner) label(pid, "Owner assigned", `${pr.title}: no owner proposed, ${owner} assigned`);
    if (owner && owner !== pr.owner) log(pid, me(), "confirm", `Changed owner of "${pr.title}" from ${pr.owner || "no owner"} to ${owner}`);
    if (!owner) continue;
    made.push({ id: "o-" + pr.id, pid, stage: 3, title: pr.title, owner, due: pr.due, dueDay: 6, assignedBy: me(), fromPia: true });
    if (!p.team.includes(owner)) p.team.push(owner);
  }
  S.extraTasks.push(...made);
  const ws = confirmWrites("owners", p, run(pid), { tasks: made });
  conf(pid).owners = { by: me(), writes: ws };
  log(pid, me(), "confirm", `Confirmed task owners: ${made.map(t => t.owner + " (" + t.title + ")").join("; ") || "none"}`);
  write(pid, "owners", ws);
  if (pid === "hv") S.done.t2 = true;
}
function assignFlagCore(pid, prId, who) {
  const pr = run(pid).proposals.find(x => x.id === prId); const p = pilot(pid);
  (S.assigned[pid] = S.assigned[pid] || {})[prId] = who;
  S.extraTasks.push({ id: "o-" + prId, pid, stage: 3, title: pr.title, owner: who, due: pr.due, dueDay: 6, assignedBy: me(), fromPia: true });
  if (!p.team.includes(who)) p.team.push(who);
  label(pid, "Owner assigned", `${pr.title}: no owner proposed, ${who} assigned`);
  log(pid, me(), "confirm", `Assigned the flagged task "${pr.title}" to ${who}`);
  write(pid, "assign", confirmWrites("assign", p, run(pid), { title: pr.title, owner: who }));
}
function slackText(pid) {
  const r = run(pid); const kept = r.ideas.filter(i => i.status === "kept");
  return `#pilot-${pid}-${pilot(pid).firm.split(" ")[0].toLowerCase()}: ${pilot(pid).firm} pilot plan agreed by ${conf(pid).ideas.by}. ${kept.length} use cases: ${kept.map(i => i.name).join("; ")}. ${r.questions.length} questions for the firm (${pilot(pid).ae}). Next: task owners and the first training invites.`;
}

// ---------- actions ----------
const A = {
  role(r) { S.role = r; S.panel = null; S.modal = null; S.navOpen = false; go(LANDING[r]); },
  stageChange() {
    const p = pilot("hv"); if (p.stage !== "Proof of value") return;
    p.stage = "Pilot: design"; log("hv", "Salesforce", "start", "Stage changed from Proof of value to Pilot");
    toast("Salesforce: Harrow & Vale moved to Pilot. Pia started a run.");
    if (canView(S.role, p)) go("pilots/hv/overview");
    startRun("hv", { trigger: "Deal reached pilot stage in Salesforce", kind: "stage" });
  },
  stageAgain() { log("hv", "Salesforce", "start", "Stage change sent again for Harrow & Vale"); startRun("hv", { trigger: "Deal reached pilot stage in Salesforce (sent again)", kind: "stage" }); },
  landCall() {
    if (S.g2Landed) return; S.g2Landed = true; const p = pilot("hv");
    log("hv", "Gong", "start", "New call landed: Follow-up call, 18 Nov 2026"); p.calls.push("g2");
    if (conf("hv").ideas) { toast("New call landed after Tom confirmed the ideas. Pia did not re-run; Tom was told."); log("hv", "PilotHQ", "check", "Ideas already confirmed, so no re-run. Legal Engineer notified."); render(); return; }
    if (!run("hv") || run("hv").status !== "waiting") { toast("Gong: follow-up call landed. Pia will read it on the next run."); render(); return; }
    toast("Gong: follow-up call landed. Pia is re-running.");
    startRun("hv", { trigger: "New call landed in Gong before the ideas were confirmed (Follow-up call, 18 Nov)", kind: "call", merge: true });
  },
  reread(pid) { log(pid, me(), "start", "Asked Pia to re-read the calls"); startRun(pid, { trigger: "Re-read requested by " + me(), kind: "manual", merge: true }); },
  toggleModel() { S.modelDown = !S.modelDown; toast(S.modelDown ? "Model outage on: the next run will stop cleanly." : "Model back online."); render(); },
  retry(pid) { log(pid, me(), "start", "Retry requested"); startRun(pid, { trigger: "Retry by " + me(), kind: "manual" }); },
  reset() { const role = S.role; S = freshState(); S.role = role; seed(); go(LANDING[role]); toast("Started again."); },
  demo() { S.demoOpen = !S.demoOpen; render(); },
  pia() { S.piaOpen = !S.piaOpen; render(); },
  nav() { S.navOpen = !S.navOpen; render(); },
  person(n) { S.q = ""; S.panel = { kind: "person", name: n }; render(); },
  call(call, i) {
    S.panel = { kind: "call", call, i }; const pid = S.r[0] === "pilots" || S.r[0] === "firms" ? S.r[1] : null;
    if (pid) log(pid, me(), "read", `Viewed ${CALLS[call].source} ${CALLS[call].title.toLowerCase()}${i != null ? " at " + CALLS[call].lines[i].t : ""}`);
    render(); setTimeout(() => { const el = document.querySelector(".tline.hl"); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); }, 30);
  },
  idea(id) { S.panel = { kind: "idea", id }; render(); },
  close() { S.panel = null; render(); },
  decide(id, st) {
    const pid = S.r[1]; const r = run(pid); const u = r.ideas.find(x => x.id === id); const was = { status: u.status, mergeInto: u.mergeInto };
    u.status = u.status === st ? "open" : st; u.mergeInto = null;
    if (u.status === "kept" && !u.name) u.name = u.text;
    log(pid, me(), "edit", `${u.status === "open" ? "Reset" : st === "kept" ? "Kept" : "Dropped"} idea: ${u.topic}`);
    if (u.status === "dropped") toast("Idea dropped.", "", () => Object.assign(u, was));
    render();
  },
  merge(id, el) {
    const pid = S.r[1]; const r = run(pid); const u = r.ideas.find(x => x.id === id);
    if (!el.value) { u.status = "open"; u.mergeInto = null; render(); return; }
    const t = r.ideas.find(x => x.id === el.value); u.status = "merged"; u.mergeInto = t.id;
    if (t.status !== "kept") { t.status = "kept"; if (!t.name) t.name = t.text; }
    log(pid, me(), "edit", `Merged idea "${u.topic}" into "${t.topic}"`); render();
  },
  edit(id) { S.editing = S.editing === id ? null : id; render(); },
  saveEdit(id, el) {
    const pid = S.r[1]; const u = run(pid).ideas.find(x => x.id === id); const v = el.value.trim(); S.editing = null;
    if (v && v !== u.text) { u.text = v; u.edited = true; log(pid, me(), "edit", `Edited idea "${u.topic}": "${v}"`); }
    render();
  },
  name(id, el) { const pid = S.r[1]; const u = run(pid).ideas.find(x => x.id === id); u.name = el.value.trim(); log(pid, me(), "edit", `Named use case: "${u.name}"`); render(); },
  confirmIdeas() { S.modal = { kind: "ideas" }; render(); },
  doConfirmIdeas() { const pid = S.r[1]; confirmIdeasCore(pid); S.modal = { kind: "ideasDone" }; render(); },
  pickOwner(pid, prId, el) { (S.pick[pid] = S.pick[pid] || {})[prId] = el.value || null; render(); },
  confirmOwners(pid) { confirmOwnersCore(pid); toast(`Owners confirmed. Tasks are in each owner's My work.${openFlags(pid).length ? " " + openFlags(pid).length + " still has no owner." : ""}`); render(); },
  assignFlag(pid, prId) { const who = (S.pick[pid] || {})[prId]; if (!who) { toast("Pick someone first.", "bad"); return; } assignFlagCore(pid, prId, who); toast(`${who} has the task.`); render(); },
  ask(qid) { const pid = S.r[1]; const q = run(pid).questions.find(x => x.id === qid); q.asked = !q.asked; log(pid, me(), "confirm", `${q.asked ? "Marked asked" : "Marked not asked"}: ${q.text.slice(0, 70)}`); render(); },
  answer(qid, el) { const pid = S.r[1]; const q = run(pid).questions.find(x => x.id === qid); if (q.answer === el.value) return; q.answer = el.value; log(pid, me(), "edit", `Firm's answer recorded: "${el.value}"`); toast("Answer saved. Tom sees it in Gaps."); render(); },
  slot(key, i) { const pid = S.r[1]; (S.slot[pid] = S.slot[pid] || {})[key] = i; render(); },
  copyInvite(key) { const pid = S.r[1]; const t = document.getElementById("invite-" + key).innerText; try { navigator.clipboard.writeText(t); } catch (e) {} log(pid, me(), "read", "Copied the drafted invite to send from their own calendar"); toast("Invite copied. Send it from your own calendar."); },
  markSent(key) {
    const pid = S.r[1]; const r = run(pid); (S.sent[pid] = S.sent[pid] || {})[key] = me();
    const s = r.schedule.sessions.find(x => x.key === key); const sl = s.slots[(S.slot[pid] || {})[key] || 0];
    log(pid, me(), "confirm", `Marked invite as sent from their own calendar: ${s.label}, ${sl.day} ${sl.date}`);
    if (r.schedule.sessions.every(x => S.sent[pid][x.key])) S.done.t4 = true;
    toast("Marked as sent."); render();
  },
  task(id) { S.done[id] = !S.done[id]; const t = tasks().find(x => x.id === id); log(t.pid, me(), "confirm", `${S.done[id] ? "Completed" : "Reopened"} task: ${t.title}`); if (S.done[id]) toast("Task done.", "", () => { S.done[id] = false; }); render(); },
  agenda() { S.modal = { kind: "agenda" }; log("hv", PIA_ACTOR, "draft", "Drafted the kickoff agenda from the agreed plan"); render(); },
  closeModal() { S.modal = null; render(); },
  ap(id, verdict) {
    const it = approvals().find(x => x.id === id); if (!it) return; S.apDone[id] = verdict;
    if (verdict === "approved" && it.apply) it.apply();
    log(it.pid, me(), "confirm", `${verdict === "approved" ? "Approved" : "Rejected"}: ${it.text}`);
    if (id === "staff-cr") S.done.t10 = true;
    toast(verdict === "approved" ? "Approved." : "Rejected."); render();
  },
  apFilter(f) { S.apFilter = f; render(); },
  assign(pid, w) { S.modal = { kind: "assign", pid, w }; render(); },
  confirmAssign(who) {
    const { pid, w } = S.modal; const c = capacity(pid)[w]; const flags = w === 0 ? openFlags(pid) : [];
    addCap(pid, w, c.need - c.staffed, who, flags.length > 0);
    for (const f of flags) assignFlagCore(pid, f.id, who);
    S.modal = null; toast(`${who} assigned to ${pilot(pid).firm}${flags.length ? ", with the flagged task" : ""}.`); render();
  },
  priority(pid, el) { S.priority[pid] = el.value; log(pid, me(), "edit", "Priority set to " + el.value); toast("Priority updated."); },
  actFilter(f) { S.actFilter = f; render(); },
  digest(i) { S.modal = { kind: "digest", i }; render(); },
  search(el) { S.q = el.value; renderSearch(); },
  runChecks() { S.acResults = runAcceptanceChecks(); render(); },
  runTests() { S.testRun = { n: 0 }; render(); const t = setInterval(() => { S.testRun.n++; if (S.testRun.n >= TEST_SET.length) { clearInterval(t); S.testRun.done = true; } render(); }, 80); },
  undo(id) { const t = S.toasts.find(x => String(x.id) === String(id)); if (t && t.undo) t.undo(); S.toasts = S.toasts.filter(x => x !== t); render(); },
  slack() { toast("Opens Slack in the real app."); }
};

function startRun(pid, opts) {
  const p = pilot(pid); const prev = run(pid);
  let r = runPia(p, { trigger: opts.trigger, kind: opts.kind, now: S.clock, history: S.runs[pid] || [], modelDown: S.modelDown });
  if (r.status === "skipped") {
    S.skips.push({ pid, r }); for (const st of r.steps) { const a = stepAudit(pid, st); log(pid, a.actor, a.type, a.text); }
    toast("Repeat trigger skipped: same deal and stage within 10 minutes."); render(); return;
  }
  if (opts.merge && prev && prev.status === "waiting" && r.status === "waiting") r = mergeRun(clone(prev), r);
  r.version = (S.runs[pid] || []).length + 1;
  S.runs[pid] = (S.runs[pid] || []).concat(r);
  S.anim = { pid, shown: 0 }; S.piaOpen = true; render();
  const t = setInterval(() => {
    const st = r.steps[S.anim.shown]; const a = stepAudit(pid, st); log(pid, a.actor, a.type, a.text);
    S.anim.shown++;
    if (S.anim.shown >= r.steps.length) {
      clearInterval(t); S.anim = null;
      if (r.status === "waiting") toast(r.changes && r.changes.length ? `Pia updated the ideas: ${r.changes.length} changes.` : "Pia's ideas and proposals are ready for people to decide.", "pia");
      if (r.status === "failed") toast("Run stopped cleanly. Nothing was written.", "bad");
      if (r.status === "stopped") toast("Stopped at the step limit. Nothing was written.", "bad");
    }
    render();
  }, 420);
}

// ---------- routing ----------
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length) { location.replace("#/" + LANDING[S.role]); return; }
  const prev = S.r.join("/");
  S.r = parts; S.navOpen = false;
  if (parts[0] === "pilots" && parts[1]) {
    const p = pilot(parts[1]);
    if (p && !canView(S.role, p) && !prev.startsWith("pilots/" + parts[1])) log(p.id, me(), "access", `Access denied: ${me()} is not on the deal team`);
  }
  render(); window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (S.modal) A.closeModal(); else if (S.panel) A.close(); } });

// ---------- shared bits ----------
function initials(n) { return n.split(" ").map(x => x[0]).slice(0, 2).join(""); }
function av(n, cls = "") { const p = PERSON[n]; return `<span class="av ${cls}" style="background:${p ? p.color : "#888"}" aria-hidden="true">${esc(initials(n))}</span>`; }
function pl(n, withAv = false) {
  const p = PERSON[n]; if (!p) return esc(n);
  return `<a class="ent hasprev" onclick="A.person('${jq(n)}')">${withAv ? av(n, "sm") + " " : ""}${esc(n)}<span class="prev">${av(n)}<span><b>${esc(n)}</b><br><span class="small muted">${esc(p.title)} · ${esc(p.city)}</span></span></span></a>`;
}
function fl(pid) { const p = pilot(pid); if (!canView(S.role, p)) return esc(p.firm); return `<a class="ent" onclick="go('firms/${pid}')">${esc(p.firm)}</a>`; }
function pilotLink(pid, lbl) { return `<a class="ent" onclick="go('pilots/${pid}/overview')">${esc(lbl || pilot(pid).firm)}</a>`; }
function chip(t, k = "") { return `<span class="chip ${k}">${t}</span>`; }
const PIA = `<span class="spark" aria-hidden="true">✦</span>`;
function piaBtn(lbl, on, extra = "") { return `<button class="btn pia" ${extra} onclick="${on}">${PIA} ${esc(lbl)}</button>`; }
function decided() { return chip(PIA + " Pia · Decided", "pia"); }
function riskChip(r) { return chip((r === "High" ? "▲ " : r === "Medium" ? "● " : "✓ ") + r, r === "High" ? "red" : r === "Medium" ? "warn" : "green"); }
function progressBar(pid) { const s = stageOf(pid); const pct = Math.round(s / (STAGES.length - 1) * 100); return `<div class="pbar" role="progressbar" aria-valuenow="${s + 1}" aria-valuemax="${STAGES.length}"><span style="width:${Math.max(pct, 4)}%"></span></div><div class="small muted">${esc(STAGES[s])} · ${s + 1} of ${STAGES.length}</div>`; }

function render() {
  if (!S) return;
  const active = document.activeElement && document.activeElement.id === "q";
  document.getElementById("app").innerHTML = header() + `<main id="main">${main()}</main>` + panel() + modal() + demoPanel() + toasts();
  renderSearch();
  if (active) { const q = document.getElementById("q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

function header() {
  const nav = NAV[S.role]; const cur = S.r[0] === "firms" ? "pilots" : S.r[0];
  const ap = (S.role === "le" || S.role === "esm") ? approvals().length : 0;
  return `<header class="top">
    <div class="top-l"><button class="icon menu" aria-label="Menu" onclick="A.nav()">☰</button><a class="brand" onclick="go('${LANDING[S.role]}')">Pilot<span>HQ</span></a>
      <nav class="tabsnav ${S.navOpen ? "open" : ""}" aria-label="Main">${nav.map(([k, l]) => `<a class="${cur === k ? "on" : ""}" onclick="go('${k}')">${l}${k === "approvals" && ap ? ` <span class="badge">${ap}</span>` : ""}</a>`).join("")}</nav></div>
    <div class="top-r">
      <div class="search"><input id="q" placeholder="Search" value="${esc(S.q)}" oninput="A.search(this)" aria-label="Search pilots and people"><div id="sres"></div></div>
      <button class="icon bell" aria-label="Notifications" onclick="go('${ap ? "approvals" : LANDING[S.role]}')">🔔${ap ? `<span class="dotn">${ap}</span>` : ""}</button>
      <label class="who">${av(me(), "sm")}<select aria-label="Switch role" onchange="A.role(this.value)">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === S.role ? "selected" : ""}>${esc(v.name)} · ${esc(v.label)}</option>`).join("")}</select></label>
    </div></header>`;
}
function renderSearch() {
  const box = document.getElementById("sres"); if (!box) return;
  const q = S.q.trim().toLowerCase(); if (q.length < 2) { box.innerHTML = ""; return; }
  const ps = S.pilots.filter(p => canView(S.role, p) && p.firm.toLowerCase().includes(q)).map(p => `<a onclick="S.q='';go('pilots/${p.id}/overview')"><span class="chip">Pilot</span> ${esc(p.firm)}</a>`);
  const pe = visiblePeople().filter(p => p.name.toLowerCase().includes(q)).map(p => `<a onclick="A.person('${jq(p.name)}')"><span class="chip">Person</span> ${esc(p.name)}</a>`);
  const all = [...ps, ...pe].slice(0, 8);
  box.innerHTML = `<div class="sres">${all.join("") || `<span class="small muted">No results</span>`}</div>`;
}

function main() {
  const [a, b, c] = S.r;
  if (a === "work") return workView();
  if (a === "approvals") return approvalsView();
  if (a === "pilots" && b) return pilotView(b, c || "overview");
  if (a === "pilots") return S.role === "esm" ? portfolioView() : pilotsView();
  if (a === "people") return peopleView();
  if (a === "firms") return firmView(b);
  if (a === "quality") return qualityView(b || "checks");
  return workView();
}

// ---------- My work ----------
function workView() {
  const mine = tasks().filter(t => t.owner === me() && (!t.pid || canView(S.role, pilot(t.pid))));
  const groups = [["Today", t => !S.done[t.id] && t.dueDay <= 0], ["This week", t => !S.done[t.id] && t.dueDay > 0 && t.dueDay <= 4], ["Later", t => !S.done[t.id] && t.dueDay > 4], ["Done", t => S.done[t.id]]];
  const ap = (S.role === "le" || S.role === "esm") ? approvals() : [];
  const recent = S.audit.filter(e => e.actor.startsWith("Pia") && e.pid && canView(S.role, pilot(e.pid))).slice(-5).reverse();
  return `<div class="ph"><div><div class="eyebrow">My work</div><h1>Good morning, ${esc(me().split(" ")[0])}</h1><p class="muted">${mine.filter(t => !S.done[t.id]).length} open tasks${ap.length ? ` · ${ap.length} waiting for your decision` : ""}</p></div></div>
  <div class="grid2 wide-l">
    <section>${groups.map(([g, f]) => { const ts = mine.filter(f); if (!ts.length && g !== "Today") return ""; return `<h3 class="sect">${g} <span class="count">${ts.length}</span></h3><div class="card flush">${ts.map(taskRow).join("") || `<div class="empty-s">Nothing due today.</div>`}</div>`; }).join("")}</section>
    <aside>
      ${ap.length ? `<h3 class="sect">Waiting for you</h3><div class="card flush">${ap.map(i => `<div class="row-i ${i.pia ? "pia-l" : ""}"><div>${i.pia ? chip(PIA + " Pia", "pia") : chip(i.type)} <b>${esc(pilot(i.pid).firm)}</b><div class="small">${esc(i.text)}</div></div><a class="ent small" onclick="go('${i.review || "approvals"}')">Open</a></div>`).join("")}</div>` : ""}
      <h3 class="sect">Recent Pia activity</h3><div class="card flush">${recent.map(e => `<div class="row-i pia-l"><div><div class="small muted">${e.at} · ${esc(pilot(e.pid).firm)}</div><div class="small">${esc(e.text)}</div></div></div>`).join("") || `<div class="empty-s">Pia hasn't run on your pilots today.</div>`}</div>
    </aside></div>`;
}
function taskRow(t) {
  const done = !!S.done[t.id]; const p = t.pid ? pilot(t.pid) : null;
  const open = t.route ? `go('${t.route}')` : t.tab ? `go('pilots/${t.pid}/${t.tab}')` : t.pid ? `go('pilots/${t.pid}/progress')` : "";
  const canTick = t.owner === me();
  return `<div class="task ${done ? "done" : ""}"><input type="checkbox" class="tick" ${done ? "checked" : ""} ${canTick ? "" : "disabled"} onchange="A.task('${t.id}')" aria-label="Mark done: ${esc(t.title)}">
    <div class="grow"><a class="ent" onclick="${open}">${esc(t.title)}</a><div class="small muted">${p ? pilotLink(p.id) + " · " : ""}Due ${esc(t.due)}${t.assignedBy ? " · assigned by " + pl(t.assignedBy) : ""}${t.fromPia ? " · owner proposed by Pia" : ""}</div></div>
    ${t.pia && !done ? piaBtn("Draft it", "A.agenda()") : ""}${PERSON[t.owner] ? `<span title="${esc(t.owner)}">${av(t.owner, "sm")}</span>` : ""}</div>`;
}

// ---------- Approvals ----------
function ownerSelect(pid, pr, current) {
  return `<select aria-label="Owner for ${esc(pr.title)}" onchange="A.pickOwner('${pid}','${pr.id}',this)"><option value="">No owner</option>${lesFree().map(x => `<option value="${esc(x.name)}" ${current === x.name ? "selected" : ""}>${esc(x.name)} · ${x.free} h free${x.specialities.includes(pr.practice) ? " · " + esc(pr.practice) : ""}</option>`).join("")}</select>`;
}
function ownersBlock(pid) {
  const list = liveProposals(pid); const done = !!conf(pid).owners; const can = S.role === "esm" && !done;
  return `<table class="tbl"><thead><tr><th>Task</th><th>Pia proposed</th><th>Owner</th></tr></thead><tbody>${list.map(pr => { const cur = ownerOf(pid, pr) || (S.assigned[pid] || {})[pr.id] || null; return `<tr><td><b>${esc(pr.title)}</b><div class="small muted">Due ${esc(pr.due)}, ${esc(pr.dueNote)} · ${pr.hours} h</div></td>
    <td>${pr.owner ? `${pl(pr.owner)}<div class="small muted">${esc(pr.reason)}</div>` : `${chip("▲ No owner", "warn")}<div class="small">${esc(pr.flag)}</div><div class="small muted">${esc(pr.reason)}</div>`}</td>
    <td>${can || (S.role === "esm" && !cur) ? ownerSelect(pid, pr, cur) + (done && !cur ? ` <button class="btn small primary" onclick="A.assignFlag('${pid}','${pr.id}')">Assign</button>` : "") : cur ? `${pl(cur)}${cur !== pr.owner ? ` <span class="small muted">(changed)</span>` : ""}` : `<span class="small muted">Waiting for ${esc(ROLES.esm.name)}</span>`}</td></tr>`; }).join("")}</tbody></table>`;
}
function approvalsView() {
  const f = S.apFilter;
  const items = approvals().filter(i => f === "All" || (f === "Pia proposals" && i.pia) || (f === "Staffing" && i.type === "Staffing"));
  return `<div class="ph"><div><div class="eyebrow">Approvals</div><h1>Waiting for your decision</h1><p class="muted">Pia proposes. Nothing is written until you confirm your part.</p></div></div>
  <div class="filters">${["All", "Pia proposals", "Staffing"].map(x => `<button class="fchip ${f === x ? "on" : ""}" onclick="A.apFilter('${x}')">${x}</button>`).join("")}</div>
  ${items.map(i => {
    if (i.kind === "owners") return `<div class="card flush pia-card"><div class="appr"><div class="grow"><div class="row">${chip(PIA + " Proposed by Pia", "pia")}<span class="small muted">${esc(i.type)} · ${esc(i.age)}</span></div><div class="mt4"><b>${fl(i.pid)}</b></div><div class="small muted">Matched on specialities, then most free hours this week. Change any owner before you confirm.</div></div><button class="btn primary" onclick="A.confirmOwners('${i.pid}')">Confirm owners</button></div>${ownersBlock(i.pid)}</div>`;
    if (i.kind === "flag") return `<div class="card pia-card"><div class="row between"><div>${chip("▲ No owner", "warn")} <b>${fl(i.pid)}</b><div>${esc(i.prop.title)}</div><div class="small muted">${esc(i.prop.flag)}. ${esc(i.prop.reason)}.</div></div><div class="row">${ownerSelect(i.pid, i.prop, (S.pick[i.pid] || {})[i.prop.id])}<button class="btn primary" onclick="A.assignFlag('${i.pid}','${i.prop.id}')">Assign</button></div></div><p class="small muted">Or click the short week for ${esc(pilot(i.pid).firm)} in the <a class="ent" onclick="go('pilots')">capacity grid</a>.</p></div>`;
    return `<div class="card flush"><div class="appr ${i.pia ? "pia-l" : ""}"><div class="grow"><div class="row">${i.pia ? chip(PIA + " From Pia", "pia") : chip("Requested by PilotHQ capacity check")}<span class="small muted">${esc(i.type)} · ${esc(i.age)}</span></div>
       <div class="mt4"><b>${fl(i.pid)}</b></div><div>${esc(i.text)}</div></div>
     <div class="row">${i.review ? `<button class="btn primary" onclick="go('${i.review}')">Review</button>` : `<button class="btn" onclick="A.ap('${i.id}','rejected')">Reject</button><button class="btn primary" onclick="A.ap('${i.id}','approved')">Approve</button>`}</div></div></div>`;
  }).join("") || `<div class="card empty"><h3>Nothing waiting for you</h3><p class="muted">Pia's proposals and staffing requests appear here.</p></div>`}`;
}

// ---------- Pilots list ----------
function pilotsView() {
  const list = S.pilots.filter(p => canView(S.role, p));
  return `<div class="ph"><div><div class="eyebrow">${S.role === "ae" ? "My pilots" : "Pilots"}</div><h1>${S.role === "ae" ? "How your pilots are tracking" : "Your pilots"}</h1><p class="muted">You see only pilots you are staffed on.</p></div></div>
  <div class="card flush"><table class="tbl"><thead><tr><th>Firm</th><th>Progress</th><th>Next step</th><th>Risk</th><th>Team</th></tr></thead><tbody>
  ${list.map(p => `<tr class="click" onclick="go('pilots/${p.id}/overview')"><td><b>${esc(p.firm)}</b><div class="small muted">${esc(p.region)} · ${p.users} users</div></td><td style="min-width:180px">${progressBar(p.id)}</td><td>${esc(nextStep(p))}</td><td>${riskChip(riskOf(p)[0])}</td><td><div class="avs">${p.team.map(n => av(n, "sm")).join("")}</div></td></tr>`).join("") || `<tr><td colspan="5"><div class="empty-s">No pilots yet.</div></td></tr>`}
  </tbody></table></div>`;
}

// ---------- Portfolio (Enterprise Sales Manager) ----------
function portfolioView() {
  const all = S.pilots;
  const shortNow = all.reduce((a, p) => a + Math.max(0, capacity(p.id)[0].need - capacity(p.id)[0].staffed), 0);
  const short6 = all.reduce((a, p) => a + capacity(p.id).reduce((b, c) => b + Math.max(0, c.need - c.staffed), 0), 0);
  const myTasks = tasks().filter(t => t.owner === me() && !S.done[t.id]);
  return `<div class="ph"><div><div class="eyebrow">Portfolio</div><h1>All pilots</h1><p class="muted">Progress, risk and Legal Engineer capacity per pilot.</p></div></div>
  <div class="tiles">
    <div class="tile"><span class="lbl">Pilots in flight</span><b>${all.length}</b><span class="small muted">${all.filter(p => stageOf(p.id) >= 5).length} in live usage</span></div>
    <div class="tile"><span class="lbl">At risk</span><b>${all.filter(p => riskOf(p)[0] !== "Low").length}</b><span class="small muted">${all.filter(p => riskOf(p)[0] === "High").length} high</span></div>
    <div class="tile"><span class="lbl">Legal Engineer hours short</span><b>${shortNow} h</b><span class="small muted">this week · ${short6} h over 6 weeks</span></div>
    <div class="tile"><span class="lbl">Firm decisions by 31 Jan</span><b>${all.filter(p => /Jan/.test(PROGRESS[p.id].decision)).length}</b><span class="small muted">pilots</span></div>
  </div>
  <div class="grid2 wide-l"><section>
  <h3 class="sect">Pilots</h3>
  <div class="card flush"><table class="tbl"><thead><tr><th>Firm</th><th>Progress</th><th>Next step</th><th>Criteria</th><th>Risk</th><th>Priority</th></tr></thead><tbody>
  ${all.map(p => { const [r, why] = riskOf(p); return `<tr><td><a class="ent" onclick="go('pilots/${p.id}/overview')"><b>${esc(p.firm)}</b></a><div class="small muted">${esc(p.region)} · AE ${pl(p.ae)}</div></td><td style="min-width:150px">${progressBar(p.id)}</td><td class="small">${esc(nextStep(p))}</td><td class="small">${esc(criteriaSummary(p))}</td><td>${riskChip(r)}<div class="small muted">${esc(why)}</div></td><td><select aria-label="Priority for ${esc(p.firm)}" onchange="A.priority('${p.id}',this)">${["Normal", "High", "Low"].map(o => `<option ${S.priority[p.id] === o ? "selected" : ""}>${o}</option>`).join("")}</select></td></tr>`; }).join("")}
  </tbody></table></div>
  <h3 class="sect">Capacity coming up</h3><p class="small muted">Legal Engineer hours staffed of needed, per pilot. Hover for what drives the need; click a short week to assign someone. A ▲ marks a task Pia couldn't find an owner for.</p>
  <div class="card flush"><table class="tbl cap"><thead><tr><th>Pilot</th>${WEEKS.map(w => `<th>${w}</th>`).join("")}</tr></thead><tbody>
  ${all.map(p => { const flags = openFlags(p.id).length; return `<tr><td><a class="ent" onclick="go('pilots/${p.id}/overview')">${esc(p.firm)}</a>${flags ? `<div class="small">${chip("▲ " + flags + " no owner", "warn")}</div>` : ""}</td>${capacity(p.id).map((c, w) => { const short = c.need - c.staffed; const flagHere = w === 0 && flags; const cls = c.need === 0 ? "none" : short <= 0 ? "ok" : short > c.need / 2 ? "bad" : "short"; return `<td><button class="cell ${cls}" title="${esc(c.driver)}${flagHere ? ". Includes a task with no owner." : ""}" ${short > 0 ? `onclick="A.assign('${p.id}',${w})"` : "disabled"}><b>${c.staffed}/${c.need}${flagHere ? " ▲" : ""}</b><span>${short > 0 ? "short " + short : c.need ? "covered" : "none"}</span></button></td>`; }).join("")}</tr>`; }).join("")}
  <tr class="tot"><td>Total short</td>${WEEKS.map((w, i) => `<td>${all.reduce((a, p) => a + Math.max(0, capacity(p.id)[i].need - capacity(p.id)[i].staffed), 0)} h</td>`).join("")}</tr>
  </tbody></table></div></section>
  <aside><h3 class="sect">My tasks</h3><div class="card flush">${myTasks.map(taskRow).join("") || `<div class="empty-s">All done.</div>`}</div>
  <h3 class="sect">Waiting for you</h3><div class="card flush">${approvals().map(i => `<div class="row-i ${i.pia ? "pia-l" : ""}"><div class="small"><b>${esc(pilot(i.pid).firm)}</b> · ${esc(i.text)}</div><button class="btn small" onclick="go('approvals')">Open</button></div>`).join("") || `<div class="empty-s">Nothing waiting.</div>`}</div></aside></div>`;
}
function criteriaSummary(p) {
  const pr = PROGRESS[p.id];
  if (pr.criteria) return `${pr.criteria.filter(c => !/^Not agreed/.test(c[0])).length} of ${pr.criteria.length} agreed`;
  if (!conf(p.id).ideas) return "None yet";
  const k = run(p.id).ideas.filter(u => u.status === "kept");
  return `0 of ${k.length} agreed · ${k.filter(u => u.successQuote).length} with the firm's words`;
}

// ---------- Pilot workspace ----------
function pilotView(pid, tab) {
  const p = pilot(pid);
  if (!p) return `<div class="empty card"><h3>Pilot not found</h3></div>`;
  if (!canView(S.role, p)) return `<div class="empty card"><h2>You don't have access to this pilot</h2><p class="muted">${esc(me())} is not on the deal team, so PilotHQ shows nothing about it. Pia's service account only reads the deal team's records. This attempt is in the activity log.</p><button class="btn" onclick="go('${LANDING[S.role]}')">Back</button></div>`;
  const r = run(pid); const anim = S.anim && S.anim.pid === pid; const ok = ready(pid);
  let action = "";
  if (conf(pid).ideas) action = chip("✓ Plan agreed by " + esc(conf(pid).ideas.by), "green big");
  else if (ok && me() === p.les[0]) { const prob = ideasProblem(r); action = `<button class="btn primary big" ${prob ? "disabled" : ""} onclick="A.confirmIdeas()">Confirm ideas</button>${prob ? `<div class="small muted">${esc(prob)}</div>` : ""}`; }
  else if (ok) action = `<span class="small muted">Waiting for ${pl(p.les[0])} to confirm the ideas</span>`;
  const count = k => {
    if (k === "progress") { const n = tasks().filter(t => t.pid === pid && !S.done[t.id] && t.stage === stageOf(pid)).length; return n || ""; }
    if (!ok) return ""; if (k === "ideas") return r.ideas.length; if (k === "gaps") return r.questions.filter(q => !q.answer).length || ""; if (k === "schedule") return r.schedule ? r.schedule.sessions.length : ""; return "";
  };
  const tabName = (PILOT_TABS.find(t => t[0] === tab) || [0, "Overview"])[1];
  const showPia = S.piaOpen && !p.static;
  return `<div class="crumbs"><a class="ent subtle" onclick="go('pilots')">${S.role === "esm" ? "Portfolio" : "Pilots"}</a> / ${fl(pid)} / <span class="muted">${tabName}</span></div>
  <div class="ph pilot-h"><div><h1>${esc(p.firm)}</h1>
    <div class="row wrap small muted">${chip(esc(STAGES[stageOf(pid)]))}<span>${esc(p.region)}</span>·<span>${p.users} users</span>·<span>${p.days} days</span>·<span>AE ${pl(p.ae)}</span>·<span>LE ${p.les.map(n => pl(n)).join(", ")}</span></div></div>
    <div class="actions">${action}${p.static ? "" : `<button class="btn pia ghost" onclick="A.pia()" aria-expanded="${S.piaOpen}">${PIA} ${S.piaOpen ? "Hide" : "Show"} Pia</button>`}</div></div>
  ${anim ? `<div class="piabar" aria-label="Pia is working"><span></span></div>` : ""}
  <nav class="ptabs" role="tablist">${PILOT_TABS.map(([k, l]) => `<a role="tab" tabindex="0" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}" onclick="go('pilots/${pid}/${k}')" onkeydown="if(event.key==='Enter')go('pilots/${pid}/${k}')">${l}${count(k) !== "" ? ` <span class="count">${count(k)}</span>` : ""}</a>`).join("")}</nav>
  ${ok && r.changes && r.changes.length && !conf(pid).ideas ? `<div class="banner pia-b">${PIA} <b>Pia re-read the calls after the follow-up call.</b> Your decisions and edits were kept. ${r.changes.map(esc).join(" · ")}</div>` : ""}
  <div class="work ${showPia ? "with-pia" : ""}"><section class="tabbody">${tabBody(p, r, anim, tab)}</section>${showPia ? `<aside class="piapanel">${piaPanel(p, r, anim)}</aside>` : ""}</div>`;
}

function tabBody(p, r, anim, tab) {
  if (tab === "overview") return overviewTab(p, r);
  if (tab === "progress") return progressTab(p);
  if (tab === "team") return teamTab(p);
  if (tab === "activity") return activityTab(p);
  if (p.static) return `<div class="empty card"><h3>Set up by hand</h3><p class="muted">This pilot was set up before Pia. See Progress and Team.</p></div>`;
  if (anim) return `<div class="card">${[1, 2, 3, 4].map(() => `<div class="skel"></div>`).join("")}<p class="small muted">${PIA} Pia is reading the calls. Nothing shows until the source check has run.</p></div>`;
  const st = runStatusCard(r); if (st) return st;
  if (tab === "ideas") return ideasTab(p, r);
  if (tab === "gaps") return gapsTab(p, r);
  if (tab === "schedule") return scheduleTab(p, r);
  return "";
}
function runStatusCard(r) {
  if (!r) return `<div class="empty card"><h3>Nothing from Pia yet</h3><p class="muted">Pia reads the calls when the deal reaches pilot stage in Salesforce.</p></div>`;
  if (r.status === "nothing") return `<div class="empty card"><h3>Nothing to read</h3><p class="muted">This pilot has no recorded calls Pia is allowed to read, so Pia drafted nothing rather than guessing.</p></div>`;
  if (r.status === "failed") return `<div class="empty card"><h3>Pia's run stopped</h3><p class="muted">The model did not respond. Nothing was half-written. ${S.role === "le" ? "Try again from the Pia panel." : "The Legal Engineer has been told to retry."}</p></div>`;
  if (r.status === "ambiguous") return `<div class="empty card"><h3>Which deal is this pilot for?</h3><p class="muted">The firm has more than one open deal, so Pia stopped and drafted nothing. The Account Executive has been asked.</p></div>`;
  if (r.status === "stopped") return `<div class="empty card"><h3>Stopped at the step limit</h3><p class="muted">Pia used all ${r.maxSteps} tool steps and stopped cleanly. What was drafted is kept in the Pia panel. Nothing was written.</p></div>`;
  return "";
}

function overviewTab(p, r) {
  const pr = PROGRESS[p.id]; const s = stageOf(p.id); const f = FIRMS[p.id]; const ok = ready(p.id);
  const kept = ok && conf(p.id).ideas ? r.ideas.filter(u => u.status === "kept") : [];
  const next = tasks().filter(t => t.pid === p.id && !S.done[t.id]).slice(0, 4);
  const qs = ok ? r.questions : [];
  const isAE = me() === p.ae;
  return `<div class="ov">
   <div class="card"><div class="lbl">How it's tracking</div>${miniStepper(p.id)}
     <div class="kv"><span>Stage</span><b>${esc(STAGES[s])}</b><span>Days left</span><b>${pr.daysLeft}</b><span>Firm decides</span><b>${esc(pr.decision)}</b><span>Success criteria</span><b>${esc(criteriaSummary(p))}</b><span>Questions for the firm</span><b>${qs.length ? `${qs.filter(q => q.asked).length} of ${qs.length} asked` : "0"}</b><span>Risk</span><b>${riskChip(riskOf(p)[0])}</b></div>
     <a class="ent small" onclick="go('pilots/${p.id}/progress')">Progress and checklist →</a></div>
   <div class="card"><div class="lbl">Firm</div><h3>${fl(p.id)}</h3><p class="small">${esc(f.about)}</p>
     <div class="kv"><span>HQ</span><b>${esc(f.hq)}</b><span>Offices</span><b>${f.offices.map(esc).join(", ")}</b><span>Lawyers</span><b>${f.lawyers}</b><span>Pilot</span><b>${p.users} users · ${p.days} days</b>${(S.role === "ae" || S.role === "esm") && p.salesforce ? `<span>Deal</span><b>${esc(p.salesforce.amount)}</b>` : ""}</div></div>
   <div class="card"><div class="row between"><div class="lbl">What's agreed</div>${kept.length ? chip("✓ Agreed by " + esc(conf(p.id).ideas.by), "green") : ""}</div>${p.static ? (pr.criteria || []).map(c => `<p class="small">• ${esc(c[0])}</p>`).join("") : kept.length ? `<ul class="plain">${kept.map(u => `<li><a class="ent" onclick="A.idea('${u.id}')">${esc(u.name)}</a><div class="small muted">${esc(u.practice)} · ${u.successQuote ? "the firm said: “" + esc(u.successQuote.quote) + "”" : "success measure to agree with the firm"}</div></li>`).join("")}</ul>` : ok ? `<p class="small">${r.ideas.length} ideas from the calls are waiting for ${pl(p.les[0])}.</p><a class="ent small" onclick="go('pilots/${p.id}/ideas')">See the ideas →</a>` : `<p class="small muted">Nothing agreed yet.</p>`}</div>
   <div class="card ${qs.length ? "pia-card" : ""}"><div class="row between"><div class="lbl">Questions for the firm</div>${qs.length ? chip(PIA + " Pia looked first", "pia") : ""}</div>
     ${qs.length ? qs.map(q => `<div class="qrow"><p class="small">${esc(q.text)} ${srcLink(q.cite, "icon")}</p>
       <div class="row wrap">${q.asked ? chip("✓ Asked", "green") : chip("Not asked yet")}${isAE ? `<button class="btn small" onclick="A.ask('${q.id}')">${q.asked ? "Undo" : "Mark asked"}</button>` : ""}</div>
       ${isAE && q.asked ? `<input class="ans" aria-label="The firm's answer" placeholder="The firm's answer" value="${esc(q.answer)}" onchange="A.answer('${q.id}',this)">` : q.answer ? `<p class="small"><b>Answer:</b> ${esc(q.answer)}</p>` : ""}</div>`).join("") : `<p class="small muted">${ok ? "None. Pia found everything it needed in the calls." : "Pia lists questions here when the calls don't cover something."}</p>`}</div>
   <div class="card"><div class="lbl">What's next</div>${next.map(t => `<div class="row-i nb"><a class="ent small" onclick="go('pilots/${p.id}/progress')">${esc(t.title)}</a><span class="row small muted nowrap">${esc(t.due)} ${av(t.owner, "sm")}</span></div>`).join("") || `<p class="small muted">No open tasks.</p>`}</div>
   <div class="card ${ok && r.proposals.length && !conf(p.id).owners ? "pia-card" : ""}"><div class="row between"><div class="lbl">Tasks for Legal Engineering</div>${ok && r.proposals.length ? (conf(p.id).owners ? chip("✓ Owners confirmed by " + esc(conf(p.id).owners.by), "green") : chip(PIA + " Owners proposed by Pia", "pia")) : ""}</div>
     ${ok && r.proposals.length ? liveProposals(p.id).map(pr => { const o = ownerOf(p.id, pr) || (S.assigned[p.id] || {})[pr.id]; return `<div class="row-i nb"><span class="small">${esc(pr.title)}</span><span class="small nowrap">${o ? pl(o) : chip("▲ No owner", "warn")}</span></div>`; }).join("") + (conf(p.id).owners ? "" : `<p class="small muted">Waiting for ${pl(ROLES.esm.name)} to confirm.</p>`) : `<p class="small muted">None proposed yet.</p>`}</div>
   <div class="card span2"><div class="row between"><div class="lbl">Team</div><a class="ent small" onclick="go('pilots/${p.id}/team')">Workstreams and DRIs →</a></div><div class="row wrap">${p.team.map(n => `<span class="person-chip">${pl(n, true)}<span class="small muted">${esc(PERSON[n] ? PERSON[n].title : "")}</span></span>`).join("")}</div></div>
   <div class="card span2"><div class="lbl">Sources Pia reads</div><div class="row wrap">${SOURCES.map(([n, what, t]) => `<button class="src-chip" onclick="S.actFilter='${n}';go('pilots/${p.id}/activity')"><b>${n}</b><span class="small muted">${what} · ${t}</span></button>`).join("")}</div></div>
   <div class="card span2 later"><div class="lbl">Later, if Legal Engineering wants it</div><div class="row wrap">${LATER.map(x => `<button class="btn pia" disabled title="Coming later" aria-label="${esc(x)}, coming later">${PIA} ${esc(x)}</button>`).join("")}</div></div>
  </div>`;
}
function miniStepper(pid) { const s = stageOf(pid); const bl = PROGRESS[pid].blocked; return `<div class="mini" aria-label="Stage ${s + 1} of ${STAGES.length}">${STAGES.map((st, i) => `<span class="${i < s ? "d" : i === s ? (bl ? "b" : "c") : ""}" title="${esc(st)}"></span>`).join("")}</div>`; }

function progressTab(p) {
  const pr = PROGRESS[p.id]; const s = stageOf(p.id);
  const dates = p.id === "hv" ? pr.dates.map((d, i) => (i === 1 || i === 2) && !run("hv") ? "Planned" : d) : pr.dates;
  const cl = tasks().filter(t => t.pid === p.id && t.stage === s);
  const r = run(p.id);
  const crit = pr.criteria || (conf(p.id).ideas ? r.ideas.filter(u => u.status === "kept").map(u => [`${u.name}: ${u.successQuote ? "the firm said “" + u.successQuote.quote + "”" : "measure to agree"}`, "Not agreed"]) : []);
  const warn = ["hv", "lh", "cr"].includes(p.id);
  return `<div class="card"><ol class="stepper">${STAGES.map((st, i) => { const state = i < s ? "done" : i === s ? (pr.blocked ? "blocked" : "current") : "up"; return `<li class="${state}"><span class="sdot">${state === "done" ? "✓" : state === "blocked" ? "!" : i + 1}</span><div><b>${esc(st)}</b><div class="small muted">${esc(dates[i] || "")}</div><div class="small">${pr.owners[i] && PERSON[pr.owners[i]] ? pl(pr.owners[i]) : esc(pr.owners[i] || "")}</div></div></li>`; }).join("")}</ol>
    <div class="row wrap small mt12">${chip(pr.daysLeft + " days left")}<span>Readout ${esc(pr.readout)}</span>·<span>Firm decides ${esc(pr.decision)}</span></div>
    ${warn ? `<div class="banner warn small mt12">The readout is less than two weeks before the firm decides. Consider moving it earlier.</div>` : ""}</div>
  <div class="grid2"><section><h3 class="sect">Checklist: ${esc(STAGES[s])} <span class="count">${cl.filter(t => !S.done[t.id]).length} open</span></h3>
   <div class="card flush">${cl.map(taskRow).join("") || `<div class="empty-s">No tasks for this stage.</div>`}</div></section>
   <section><h3 class="sect">Success criteria</h3><div class="card flush">${crit.map(([c, st]) => `<div class="row-i"><span class="small">${esc(c)}</span>${chip(st, st === "Met" ? "green" : st === "On track" ? "blue" : st === "At risk" ? "red" : "")}</div>`).join("") || `<div class="empty-s">The Legal Engineer agrees these with the firm once the plan is agreed.</div>`}</div></section></div>`;
}

function teamTab(p) {
  const ws = WORKSTREAMS[p.id] || [];
  const nextFor = n => tasks().find(t => t.pid === p.id && t.owner === n && !S.done[t.id]);
  return `<p class="small muted">Who owns each workstream on this pilot.</p><div class="card flush"><table class="tbl"><thead><tr><th>Workstream</th><th>DRI</th><th>Side</th><th>Status</th><th>Next task</th><th>Due</th></tr></thead><tbody>
  ${ws.map(([w, n]) => { const t = nextFor(n); const pe = PERSON[n]; return `<tr><td><b>${esc(w)}</b></td><td>${pl(n, true)}<div class="small muted">${esc(pe ? pe.title : "")}</div></td><td>${pe && pe.org === "ABC Inc." ? chip("ABC Inc.") : chip("Firm", "warn")}</td><td>${t ? chip("In progress", "blue") : chip("On track", "green")}</td><td class="small">${t ? esc(t.title) : `<span class="muted">Nothing open</span>`}</td><td class="small nowrap">${t ? esc(t.due) : ""}</td></tr>`; }).join("")}
  </tbody></table></div>`;
}

function activityTab(p) {
  const f = S.actFilter;
  const filters = ["All", "Pia", "Decisions", "Checks", "People", "Digests", ...SOURCES.map(s => s[0])];
  let rows = S.audit.filter(e => e.pid === p.id);
  if (f === "Pia") rows = rows.filter(e => e.actor.startsWith("Pia"));
  else if (f === "Decisions") rows = rows.filter(e => e.type === "decision" || e.type === "confirm");
  else if (f === "Checks") rows = rows.filter(e => e.type === "check");
  else if (f === "People") rows = rows.filter(e => PERSON[e.actor]);
  else if (f !== "All" && f !== "Digests") rows = rows.filter(e => (e.actor + " " + e.text).includes(f));
  const slack = conf(p.id).ideas ? `<div class="slack"><div class="small muted">#pilot-${p.id}-${p.firm.split(" ")[0].toLowerCase()} · PilotHQ · posted after ${esc(conf(p.id).ideas.by)} confirmed</div><p><b>${esc(p.firm)} pilot plan agreed</b> by ${esc(conf(p.id).ideas.by)}.<br>${run(p.id).ideas.filter(i => i.status === "kept").map(i => "• " + esc(i.name)).join("<br>")}<br>${run(p.id).questions.length} questions for the firm (${esc(p.ae)}). Next: task owners and the first training invites.</p></div>` : "";
  return `<div class="filters">${filters.map(x => `<button class="fchip ${f === x ? "on" : ""}" onclick="A.actFilter('${x}')">${x}</button>`).join("")}</div>
  ${f === "Digests" ? digestsList() : (f === "All" || f === "Slack" ? slack : "") + auditTable(rows, true)}`;
}
function digestsList() {
  return `<div class="row between"><p class="small muted">Weekly digest, posted to #growth-pilots every Monday at 08:00.</p>${piaBtn("Preview next digest", "A.digest(-1)")}</div>
  <div class="card flush">${DIGESTS.map((d, i) => `<div class="row-i click" onclick="A.digest(${i})"><div><b>${d.week}</b><div class="small muted">#growth-pilots · sent ${d.sent} · ${d.items.length} pilots</div></div><span class="ent small">Open</span></div>`).join("")}</div>`;
}
function auditTable(rows, inPilot) {
  const icon = { start: "▶", read: "📖", draft: "✎", check: "✓", decision: "✦", waiting: "…", confirm: "👤", edit: "✎", write: "⤓", access: "⛔" };
  return `<div class="card flush"><table class="tbl audit"><thead><tr><th>Time</th>${inPilot ? "" : "<th>Pilot</th>"}<th>Who</th><th>Type</th><th>What</th></tr></thead><tbody>
  ${rows.slice().reverse().map(e => `<tr class="${e.actor.startsWith("Pia") ? "pia-row" : ""}"><td class="mono small">${e.at}</td>${inPilot ? "" : `<td class="small">${esc(pilot(e.pid) ? pilot(e.pid).firm : "")}</td>`}<td class="small">${e.actor.startsWith("Pia") ? chip(PIA + " Pia", "pia") : PERSON[e.actor] ? pl(e.actor) : esc(e.actor)}</td><td>${chip((icon[e.type] || "") + " " + e.type)}</td><td class="small">${esc(e.text)}</td></tr>`).join("") || `<tr><td colspan="5"><div class="empty-s">Nothing logged yet.</div></td></tr>`}
  </tbody></table></div>`;
}

function srcLink(cite, lbl = "Source") {
  if (!cite) return "";
  const l = lineAt(cite); const c = CALLS[cite.call]; if (!l) return "";
  const i = l.text.toLowerCase().indexOf(cite.quote.toLowerCase());
  const html = i < 0 ? esc(l.text) : esc(l.text.slice(0, i)) + "<mark>" + esc(l.text.slice(i, i + cite.quote.length)) + "</mark>" + esc(l.text.slice(i + cite.quote.length));
  return `<span class="src" tabindex="0" aria-label="Source">❝${lbl === "icon" ? "" : " " + lbl}<span class="hovercard"><span class="small muted">${c.source} · ${esc(c.title)} · ${c.date} · ${l.t}</span><span class="quote">“${html}”</span><span class="small">${pl(l.who)}</span><button class="btn small" onclick="A.call('${cite.call}',${cite.i})">View in call</button></span></span>`;
}

function ideasTab(p, r) {
  const editable = me() === p.les[0] && !conf(p.id).ideas;
  const st = { open: ["To decide", "pia"], kept: ["✓ Kept", "green"], merged: ["⇢ Merged", "blue"], dropped: ["✕ Dropped", "red"] };
  const done = conf(p.id).ideas;
  return `<div class="row between"><p class="small muted">What the firm asked for, in the firm's words. Hover ❝ for the sentence. Keep, merge, edit or drop each one; kept ideas become use cases you name.</p>${done ? chip("✓ Confirmed by " + esc(done.by), "green") : chip(PIA + " Pulled out by Pia", "pia")}</div>
  <div class="card flush ${done ? "" : "pia-card"}"><table class="tbl ideas"><thead><tr><th>Idea</th><th>Practice</th><th>How they'd judge it</th><th>Decision</th><th>Use case name</th></tr></thead><tbody>
  ${r.ideas.map(u => `<tr class="${u.status}">
    <td>${S.editing === u.id && editable ? `<textarea rows="2" aria-label="Edit idea" onblur="A.saveEdit('${u.id}',this)">${esc(u.text)}</textarea>` : `<a class="ent uct" onclick="A.idea('${u.id}')">“${esc(u.text)}”</a>`} ${srcLink(u.cite, "icon")}
      <div class="small muted row wrap">${u.followUp ? chip(PIA + " Found in " + esc(u.followUp.from), "pia") : ""}${r.questions.some(q => q.ideaId === u.id) ? chip("? Question for the firm", "warn") : ""}${u.edited ? chip("Edited") : ""}${u.change === "new" ? chip("New", "pia") : u.change === "found" ? chip("Changed", "pia") : u.change === "kept" ? chip("Your edits kept") : ""}</div></td>
    <td class="small">${esc(u.practice)}</td>
    <td class="small">${u.successQuote ? `“${esc(u.successQuote.quote)}” ${srcLink(u.successQuote, "icon")}` : `<span class="muted">Not in the calls</span>`}</td>
    <td>${chip(st[u.status][0], st[u.status][1])}${u.status === "merged" ? `<div class="small muted">into ${esc((r.ideas.find(x => x.id === u.mergeInto) || {}).topic)}</div>` : ""}
      ${editable ? `<div class="row wrap small-gap"><button class="btn small ${u.status === "kept" ? "primary" : ""}" onclick="A.decide('${u.id}','kept')">Keep</button>
        <select aria-label="Merge with" onchange="A.merge('${u.id}',this)"><option value="">Merge with…</option>${r.ideas.filter(x => x.id !== u.id && x.status !== "dropped" && x.status !== "merged").map(x => `<option value="${x.id}" ${u.mergeInto === x.id ? "selected" : ""}>${esc(x.topic)}</option>`).join("")}</select>
        <button class="btn small" onclick="A.edit('${u.id}')">Edit</button><button class="btn small" onclick="A.decide('${u.id}','dropped')">Drop</button></div>` : ""}</td>
    <td>${u.status === "kept" ? (editable ? `<input class="ans" aria-label="Use case name" value="${esc(u.name)}" onchange="A.name('${u.id}',this)">` : `<b>${esc(u.name)}</b>`) : `<span class="small muted">–</span>`}</td></tr>`).join("")}
  </tbody></table></div>
  ${r.removed.length ? `<details class="card soft"><summary><b>${r.removed.length} removed by the source check</b> <span class="small muted">before anyone saw them</span></summary>${r.removed.map(x => `<p class="small"><s>${esc(x.text)}</s> · ${esc(x.why)}</p>`).join("")}</details>` : ""}
  ${r.skipped && r.skipped.length ? `<div class="banner warn small">Skipped ${r.skipped.length} call because the firm has not agreed to AI processing.</div>` : ""}`;
}
function gapsTab(p, r) {
  const fu = r.ideas.filter(u => u.followUp || r.questions.some(q => q.ideaId === u.id));
  if (!fu.length) return `<div class="empty card"><h3>No gaps</h3><p class="muted">Every idea was clear and came with how the firm would judge it.</p></div>`;
  return `<p class="small muted">Where an idea was vague or had no success measure, Pia looked in the other calls and the deal notes before asking.</p>
  ${fu.map(u => { const q = r.questions.find(x => x.ideaId === u.id); return `<div class="card pia-card"><div class="row between"><b>${esc(u.topic)}</b>${decided()}</div>
   ${u.followUp ? `<p class="small">Found in ${esc(u.followUp.from)}: ${u.followUp.cite ? `“${esc(u.followUp.cite.quote)}” ${srcLink(u.followUp.cite, "icon")}` : esc(u.followUp.note)}</p>`
   : `<p class="small">Not found in the other calls or the deal notes. Question for ${pl(p.ae)} to ask the firm:</p><p>${esc(q.text)}</p><div class="row">${q.asked ? chip("✓ Asked", "green") : chip("Not asked yet")}${q.answer ? `<span class="small"><b>Answer:</b> ${esc(q.answer)}</span>` : ""}</div>`}</div>`; }).join("")}`;
}

function inviteText(p, s, sl) {
  const firm = s.firm.map(x => x.name).join(", "); const ours = s.internal.map(x => x.name).join(", ");
  const times = sl.local.filter((x, i, a) => a.findIndex(y => y.city === x.city) === i).map(x => `${x.time} ${x.city}`).join(" / ");
  return `To: ${firm} (${p.firm.replace(" LLP", "")}); ${ours} (ABC Inc.)
Subject: Pilot: first training session for banking associates (${s.label})
When: ${sl.day} ${sl.date}, ${times} (60 min)

Hi ${s.firm.map(x => x.name.split(" ")[0]).join(" and ")},

As agreed, we'd like to start the pilot with the banking associates. This session covers the first use case, using invented documents only.${s.key === "b" ? " We've set this as a separate session so New York can join live." : ""}

Does this time work for you? Happy to move it.

Sofia`;
}
function scheduleTab(p, r) {
  const sc = r.schedule; if (!sc) return `<div class="empty card"><h3>No slots proposed</h3><p class="muted">Pia proposes slots once it has read the calls and free/busy.</p></div>`;
  const isAE = me() === p.ae;
  return `${sc.fallback ? `<div class="card pia-card"><div class="row between"><b>No time works for everyone</b>${decided()}</div><p class="small">${PIA} Pia chose to ${sc.fallback === "split" ? "split the session by region" : "record the session"}. ${esc(sc.why)}</p><div class="row small">${chip("✓ Check · Slot check passed")}<span class="muted">Every slot below is inside 08:00 to 18:00 local and clear on ABC Inc. free/busy.</span></div></div>` : ""}
  ${sc.sessions.map(s => { const sel = (S.slot[p.id] || {})[s.key] || 0; const sl = s.slots[sel]; const people = [...s.internal, ...s.firm]; const sent = (S.sent[p.id] || {})[s.key];
    return `<div class="card pia-card"><div class="row between"><div><b>${esc(p.calendar.session)}</b><div class="small muted">${esc(s.label)} · ${people.length} people</div></div>${srcLink(p.calendar.sessionCite)}</div>
    <table class="tbl slots"><thead><tr><th></th><th>Slot</th>${people.map(x => `<th>${pl(x.name)}<div class="small muted">${x.city}</div></th>`).join("")}</tr></thead><tbody>
    ${s.slots.map((x, i) => `<tr class="click ${i === sel ? "sel" : ""}" onclick="A.slot('${s.key}',${i})"><td><input type="radio" name="slot-${s.key}" aria-label="Choose ${x.day} ${x.date}" ${i === sel ? "checked" : ""}></td><td><b>${x.day} ${x.date}</b></td>${x.local.map(y => `<td>${y.time}</td>`).join("")}</tr>`).join("")}</tbody></table>
    <div class="row between mt12"><div class="lbl">Invite</div>${sent ? chip("✓ Sent by " + esc(sent), "green") : chip(PIA + " Drafted by Pia", "pia")}</div><pre id="invite-${s.key}" class="invite">${esc(inviteText(p, s, sl))}</pre>
    <div class="row wrap"><button class="btn" onclick="A.copyInvite('${s.key}')">Copy invite</button>${isAE && !sent ? `<button class="btn primary" onclick="A.markSent('${s.key}')">Mark sent</button>` : ""}<span class="small muted">PilotHQ doesn't send anything. Send it from your own calendar.</span></div></div>`; }).join("")}`;
}

function piaPanel(p, r, anim) {
  const head = `<div class="row between"><h3 class="piah">${PIA} Pia</h3><button class="icon" aria-label="Close Pia panel" onclick="A.pia()">✕</button></div><p class="small muted">Pia reads, follows up and proposes. People decide.</p>`;
  if (!r) return head + `<div class="empty-s">Pia hasn't run on this pilot yet. It starts when the deal reaches pilot stage in Salesforce.</div>`;
  const shown = anim ? S.anim.shown : r.steps.length;
  const tag = { fixed: ["Check", ""], ai: [PIA + " Pia", "pia"], decision: [PIA + " Pia · Decided", "pia"], person: ["Person", "green"] };
  const icon = { ok: "✓", warn: "!", blocked: "✕", error: "✕", stop: "■", wait: "…" };
  const canAct = me() === p.les[0] && !conf(p.id).ideas && !anim;
  const skipped = S.skips.filter(x => x.pid === p.id);
  return head + `<div class="small muted">Run ${r.version}${S.runs[p.id].length > 1 ? " of " + S.runs[p.id].length : ""} · ${r.piaVersion} · ${r.toolSteps} of ${r.maxSteps} steps · ${r.read.length} calls read</div>
   <ol class="steps">${r.steps.map((st, i) => { const state = i < shown ? st.status : i === shown && anim ? "running" : "pending"; return `<li class="st ${state} k-${st.kind}"><span class="dot">${state === "running" ? `<span class="spin"></span>` : state === "pending" ? "" : icon[st.status]}</span><div><div class="row between"><b class="small">${esc(st.label)}</b>${chip(tag[st.kind][0], tag[st.kind][1])}</div>${i < shown ? `<div class="small muted">${esc(st.detail)}</div>${st.tool ? `<span class="tool small">${esc(st.tool)}</span>` : ""}` : ""}</div></li>`; }).join("")}</ol>
   ${skipped.length ? `<p class="small muted">${skipped.length} repeat trigger${skipped.length > 1 ? "s" : ""} skipped: same deal and stage within 10 minutes.</p>` : ""}
   <div class="stack">${["failed", "stopped"].includes(r.status) && S.role === "le" && !anim ? piaBtn("Ask Pia to try again", `A.retry('${p.id}')`) : ""}
   ${canAct && r.status === "waiting" ? piaBtn("Ask Pia to re-read the calls", `A.reread('${p.id}')`) : ""}</div>`;
}

// ---------- People, firm ----------
function peopleView() {
  const ppl = visiblePeople();
  const groups = [["ABC Inc.", ppl.filter(p => p.org === "ABC Inc.")], ["Firm contacts", ppl.filter(p => p.org !== "ABC Inc.")]];
  return `<div class="ph"><div><div class="eyebrow">People</div><h1>Who's who</h1><p class="muted">ABC Inc. staff, and firm contacts on pilots you can see.</p></div></div>
  ${groups.map(([g, list]) => list.length ? `<h3 class="sect">${g}</h3><div class="cards people">${list.map(p => `<button class="card click pcard" onclick="A.person('${jq(p.name)}')">${av(p.name, "lg")}<div><b>${esc(p.name)}</b><div class="small muted">${esc(p.title)}${p.org !== "ABC Inc." ? " · " + esc(pilot(p.org).firm) : ""}</div><div class="small">${esc(p.city)}</div></div></button>`).join("")}</div>` : "").join("")}`;
}
function firmView(pid) {
  const p = pilot(pid); if (!p) return "";
  if (!canView(S.role, p)) return `<div class="empty card"><h2>You don't have access to this firm</h2><p class="muted">You're not on its deal team.</p></div>`;
  const f = FIRMS[pid]; const contacts = PEOPLE.filter(x => x.org === pid);
  return `<div class="crumbs"><a class="ent subtle" onclick="go('pilots')">${S.role === "esm" ? "Portfolio" : "Pilots"}</a> / <span class="muted">${esc(p.firm)}</span></div>
  <div class="ph"><div><div class="eyebrow">Firm</div><h1>${esc(p.firm)}</h1><p class="muted">${esc(f.about)}</p></div><button class="btn primary" onclick="go('pilots/${pid}/overview')">Open pilot</button></div>
  <div class="grid2"><div class="card"><div class="lbl">Profile</div><div class="kv"><span>HQ</span><b>${esc(f.hq)}</b><span>Offices</span><b>${f.offices.map(esc).join(", ")}</b><span>Lawyers</span><b>${f.lawyers}</b></div><div class="lbl">Practice areas</div><div class="row wrap">${f.practices.map(x => chip(esc(x))).join("")}</div></div>
  <div class="card"><div class="lbl">Contacts</div>${contacts.map(c => `<div class="row-i nb">${pl(c.name, true)}<span class="small muted">${esc(c.title)}</span></div>`).join("") || `<p class="small muted">No contacts recorded yet.</p>`}</div>
  <div class="card"><div class="lbl">Pilot</div><p>${pilotLink(pid, "Open the pilot")} · ${p.users} users · ${p.days} days</p>${progressBar(pid)}</div>
  <div class="card"><div class="lbl">Calls</div>${(p.calls || []).map(c => `<div class="row-i nb"><a class="ent" onclick="A.call('${c}',null)">${CALLS[c].source} · ${esc(CALLS[c].title)}</a><span class="small muted">${CALLS[c].date}${CALLS[c].consent ? "" : " · no AI consent"}</span></div>`).join("") || `<p class="small muted">No recorded calls.</p>`}
  ${p.salesforce && (S.role === "ae" || S.role === "esm") ? `<div class="lbl mt12">Deal</div><p class="small">${esc(p.salesforce.opportunity)} · ${esc(p.salesforce.amount)} · closes ${esc(p.salesforce.closeDate)}</p>` : ""}</div></div>`;
}

// ---------- Quality (AI Enablement) ----------
function qualityView(tab) {
  const tabs = [["checks", "Acceptance checks"], ["tests", "Test set"], ["learning", "Learning"], ["runs", "Run log"], ["health", "Health"]];
  return `<div class="ph"><div><div class="eyebrow">Quality</div><h1>Is Pia safe and working?</h1><p class="muted">Pia runs on every pilot, for every team. This is where you check it.</p></div></div>
  <nav class="ptabs">${tabs.map(([k, l]) => `<a class="${tab === k ? "on" : ""}" onclick="go('quality/${k}')">${l}</a>`).join("")}</nav>
  ${tab === "checks" ? acView() : tab === "tests" ? testView() : tab === "learning" ? learningView() : tab === "runs" ? runLog() : healthView()}`;
}
function acView() {
  const res = S.acResults; const passed = res ? res.filter(r => r.pass).length : 0;
  return `<div class="row between"><p class="muted small">Each acceptance check, run against ${PIA_VERSION}.</p><button class="btn primary" onclick="A.runChecks()">Run all ${AC_DEFS.length} checks</button></div>
  ${res ? `<div class="banner ${passed === res.length ? "good" : "bad"}">${passed} of ${res.length} acceptance checks pass</div>` : ""}
  <div class="card flush"><table class="tbl"><thead><tr><th>#</th><th>Check</th><th>Result</th></tr></thead><tbody>
  ${AC_DEFS.map((d, i) => { const r = res && res[i]; return `<tr><td><b>${i + 1}</b></td><td class="small">${esc(d)}</td><td>${r ? `${chip(r.pass ? "✓ Pass" : "✕ Fail", r.pass ? "green" : "red")}<div class="small muted">${esc(r.evidence)}</div>` : `<span class="small muted">Not run</span>`}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function testView() {
  const t = S.testRun; const n = t ? t.n : 0; const rows = TEST_SET.slice(0, n);
  const lab = rows.reduce((a, r) => a + r[2], 0), found = rows.reduce((a, r) => a + r[3], 0), inv = rows.reduce((a, r) => a + r[4], 0);
  const pct = lab ? Math.round(found / lab * 100) : 0; const done = t && t.done;
  return `<div class="row between"><p class="muted small">24 past pilots whose ideas were labelled by Legal Engineers. Pass mark: at least 80% of ideas found and none invented. A failure blocks release.</p><button class="btn primary" onclick="A.runTests()">Run test set</button></div>
  <div class="tiles"><div class="tile"><span class="lbl">Ideas found</span><b>${t ? pct + "%" : "–"}</b><span class="small muted">${t ? `${found} of ${lab}` : "target 80%"}</span></div><div class="tile"><span class="lbl">Ideas invented</span><b>${t ? inv : "–"}</b><span class="small muted">target 0</span></div><div class="tile"><span class="lbl">Release gate</span><b>${done ? (pct >= 80 && inv === 0 ? `<span class="okc">✓ Pass</span>` : `<span class="badc">Blocked</span>`) : t ? "Running" : "–"}</b><span class="small muted">${PIA_VERSION}</span></div></div>
  <div class="card flush"><table class="tbl"><thead><tr><th>Past pilot</th><th>Practice (de-identified)</th><th>Ideas labelled</th><th>Found</th><th>Invented</th><th></th></tr></thead><tbody>
  ${rows.map(r => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${chip(Math.round(r[3] / r[2] * 100) + "%", r[3] / r[2] >= 0.8 ? "green" : "warn")}</td></tr>`).join("") || `<tr><td colspan="6"><div class="empty-s">Not run yet.</div></td></tr>`}</tbody></table></div>`;
}
function learningView() {
  const W = 560, H = 220, L = 40, R = 120, T = 16, B = 30; const xs = i => L + i * ((W - L - R) / (LEARNING.weeks.length - 1)); const ys = v => T + (100 - v) / 50 * (H - T - B);
  const series = [["Ideas kept unchanged", LEARNING.ideasKept, "var(--pia)"], ["Owners accepted unchanged", LEARNING.ownersAccepted, "var(--blue)"]];
  const grid = [50, 75, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" class="gl"/><text x="${L - 8}" y="${ys(v) + 4}" text-anchor="end" class="ax">${v}%</text>`).join("");
  const xl = LEARNING.weeks.map((w, i) => `<text x="${xs(i)}" y="${H - 8}" text-anchor="middle" class="ax">${w}</text>`).join("");
  const ly = series.map(([, v]) => ys(v.at(-1)) + 4); if (Math.abs(ly[0] - ly[1]) < 14) { const mid = (ly[0] + ly[1]) / 2, up = ly[0] < ly[1] ? 0 : 1; ly[up] = mid - 7; ly[1 - up] = mid + 7; }
  const lines = series.map(([n, v, c], si) => `<polyline fill="none" stroke="${c}" stroke-width="2" points="${v.map((y, i) => xs(i) + "," + ys(y)).join(" ")}"/>${v.map((y, i) => `<circle cx="${xs(i)}" cy="${ys(y)}" r="4" fill="${c}" stroke="var(--surface)" stroke-width="2"><title>${n}, week of ${LEARNING.weeks[i]}: ${y}%</title></circle><circle cx="${xs(i)}" cy="${ys(y)}" r="12" fill="transparent"><title>${n}, week of ${LEARNING.weeks[i]}: ${y}%</title></circle>`).join("")}<text x="${xs(v.length - 1) + 10}" y="${ly[si]}" class="dl">${v.at(-1)}% ${n.split(" ")[0].toLowerCase()}</text>`).join("");
  const labels = [...S.labels.slice().reverse(), ...LEARNING.labels];
  return `<p class="small">Approved ideas, with client details removed, become examples for later runs in the same practice area.</p>
  <div class="grid2 wide-l"><div class="card"><div class="lbl">Trend, by week</div>
    <div class="legend small">${series.map(([n, , c]) => `<span><i style="background:${c}"></i>${n}</span>`).join("")}</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ideas kept unchanged rose from 58% to 81%; owners accepted unchanged rose from 70% to 83%, over four weeks">${grid}${xl}${lines}</svg>
    <div class="tscroll"><table class="tbl small"><thead><tr><th>Week of</th>${LEARNING.weeks.map(w => `<th>${w}</th>`).join("")}</tr></thead><tbody>${series.map(([n, v]) => `<tr><td>${n}</td>${v.map(x => `<td>${x}%</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
  <div class="card"><div class="lbl">Examples in the learning store</div>${Object.entries(LEARNING.examples).map(([k, e]) => `<div class="row-i nb"><span class="small">${esc(k)}</span><b class="small">${e.n} approved ideas</b></div>`).join("")}</div></div>
  <h3 class="sect">Latest labels <span class="count">${labels.length}</span></h3>
  <div class="card flush"><table class="tbl"><thead><tr><th>When</th><th>Pilot</th><th>Label</th><th>Detail</th><th>By</th></tr></thead><tbody>
  ${labels.map(l => `<tr><td class="small">${esc(l.at)}</td><td class="small">${esc(l.pilot)}</td><td>${chip(esc(l.kind), /dropped|changed/i.test(l.kind) ? "warn" : /kept|accepted/i.test(l.kind) ? "green" : "")}</td><td class="small">${esc(l.detail)}</td><td class="small">${PERSON[l.by] ? pl(l.by) : esc(l.by)}</td></tr>`).join("")}</tbody></table></div>`;
}
function runLog() {
  const all = []; for (const [pid, rs] of Object.entries(S.runs)) rs.forEach(r => all.push({ pid, r })); for (const s of S.skips) all.push(s);
  all.sort((a, b) => a.r.at - b.r.at);
  const kc = { waiting: "green", failed: "red", skipped: "", stopped: "warn", ambiguous: "warn", nothing: "warn" };
  return `<div class="card flush"><table class="tbl"><thead><tr><th>Run</th><th>Version</th><th>Pilot</th><th>Trigger</th><th>Status</th><th>Steps used</th><th>Sources</th><th>Ideas kept / removed</th><th>Questions</th><th>Cost</th></tr></thead><tbody>
  ${all.map(({ pid, r }) => `<tr><td>${r.version ? "v" + r.version : "–"}</td><td class="mono small">${r.piaVersion}</td><td>${esc(pilot(pid).firm)}</td><td class="small">${esc(r.trigger)}</td><td>${chip(r.status === "waiting" ? "waiting for people" : r.status, kc[r.status])}${r.reason ? `<div class="small muted">${esc(r.reason)}</div>` : ""}</td><td>${r.toolSteps} of ${r.maxSteps}</td><td class="small">${r.read.length ? r.read.map(c => CALLS[c].source).join(", ") : "none"}</td><td>${r.ideas.length} / ${r.removed.length}</td><td>${r.questions.length}</td><td>${r.toolSteps ? "$" + (0.4 + 0.12 * r.toolSteps).toFixed(2) : "$0.00"}</td></tr>`).join("") || `<tr><td colspan="10"><div class="empty-s">No runs yet.</div></td></tr>`}</tbody></table></div>
  <h3 class="sect">All activity</h3>${auditTable(S.audit, false)}`;
}
function healthView() {
  return `<div class="card"><div class="lbl">Pia's boundary</div><div class="kv"><span>Tools</span><b>${Object.keys(TOOLS).join(", ")} (${Object.values(TOOLS).every(t => t.readOnly) ? "all read-only" : "includes a write tool"})</b><span>Step limit</span><b>${MAX_STEPS} tool steps per run</b><span>Repeat triggers</span><b>Same deal and stage within 10 minutes is skipped</b><span>Version</span><b>${PIA_VERSION}</b><span>Writes</span><b>Only PilotHQ, after a person confirms their part</b></div></div>
  <div class="card flush"><table class="tbl"><thead><tr><th>Connection</th><th>Used for</th><th>Access</th><th>Scope</th><th>Last sync</th><th>Status</th><th></th></tr></thead><tbody>
  ${SOURCES.map(([n, what, t]) => `<tr><td><b>${n}</b></td><td class="small">${what}</td><td class="small">${n === "Slack" || n === "Notion" ? "Writes after a person confirms" : "Reads only"}</td><td class="small">Deal team records only</td><td class="small">${t}</td><td>${chip("✓ Connected", "green")}</td><td><button class="btn small" onclick="toast('Reconnect starts in the real app.')">Reconnect</button></td></tr>`).join("")}</tbody></table></div>`;
}

// ---------- panels and modals ----------
function panel() {
  if (!S.panel) return "";
  let body = "";
  if (S.panel.kind === "person") {
    const p = PERSON[S.panel.name]; if (!p) return "";
    const local = new Date(BASE + S.clock * 1000 + p.off * 3600000).toISOString().slice(11, 16);
    const pilots = S.pilots.filter(x => (x.team.includes(p.name) || x.id === p.org) && canView(S.role, x));
    body = `<div class="prof">${av(p.name, "xl")}<div><h2>${esc(p.name)}</h2><div class="muted">${esc(p.title)}</div><div class="small">${p.org === "ABC Inc." ? "ABC Inc." : fl(p.org)}</div></div></div>
    <div class="kv"><span>Based in</span><b>${esc(p.city)}</b><span>Local time</span><b>${local}</b><span>Languages</span><b>${p.languages.map(esc).join(", ")}</b></div>
    <div class="lbl">${p.org === "ABC Inc." ? "Specialities" : "From the calls"}</div><div class="row wrap">${p.specialities.map(x => chip(esc(x))).join("")}</div>
    ${p.hours ? `<div class="lbl">Capacity this week</div><div class="pbar"><span style="width:${Math.round(p.booked / p.hours * 100)}%"></span></div><div class="small muted">${p.booked} of ${p.hours} h booked · ${p.hours - p.booked} h free</div>` : ""}
    <div class="lbl">Pilots</div>${pilots.map(x => `<p>${pilotLink(x.id)} <span class="small muted">${esc(STAGES[stageOf(x.id)])}</span></p>`).join("") || `<p class="small muted">None you can see.</p>`}
    ${p.org === "ABC Inc." ? `<button class="btn" onclick="A.slack()">Message in Slack</button>` : ""}`;
  }
  if (S.panel.kind === "call") {
    const c = CALLS[S.panel.call];
    body = `<div class="row">${chip(c.source)}<h2>${esc(c.title)}</h2></div><div class="small muted">${c.date} · ${c.length} · ${c.consent ? "Firm agreed to recording and AI processing" : "No AI-processing consent"}</div>
    <div class="parts small">${c.people.map(esc).join("<br>")}</div>
    <div class="transcript">${c.lines.map((l, i) => `<div class="tline ${i === S.panel.i ? "hl" : ""}"><span class="mono small muted">${l.t}</span><div>${PERSON[l.who] ? pl(l.who) : `<b class="small">${esc(l.who)}</b>`}<div>${esc(l.text)}</div></div></div>`).join("")}</div>
    <p class="small muted">Transcript text is treated as data, never as instructions to Pia.</p>`;
  }
  if (S.panel.kind === "idea") {
    const pid = S.r[1]; const r = run(pid); const u = r && r.ideas.find(x => x.id === S.panel.id); if (!u) return "";
    const l = lineAt(u.cite); const q = r.questions.find(x => x.ideaId === u.id); const pr = r.proposals.find(x => x.ideaId === u.id);
    body = `<div class="lbl">Idea, in the firm's words</div><h2>“${esc(u.text)}”</h2><div class="row wrap">${chip(esc(u.practice))}${u.status === "kept" ? chip("✓ Use case: " + esc(u.name), "green") : chip(esc(u.status))}</div>
    <div class="lbl">Where it came from</div><blockquote>“${esc(l.text)}”<div class="small muted">${pl(l.who)} · ${CALLS[u.cite.call].source}, ${l.t}</div></blockquote><button class="btn small" onclick="A.call('${u.cite.call}',${u.cite.i})">View in call</button>
    <div class="lbl">How the firm would judge it</div><p>${u.successQuote ? `“${esc(u.successQuote.quote)}” ${srcLink(u.successQuote, "icon")}` : `<span class="muted">Not in the calls</span>`}</p>
    <div class="lbl">Pia's follow-up</div><p class="small">${u.followUp ? `Found in ${esc(u.followUp.from)}.` : q ? `Not found. Question for the firm: ${esc(q.text)}` : "None needed."}</p>
    <div class="lbl">Task</div><p class="small">${pr ? `${esc(pr.title)} · ${pr.owner ? "proposed owner " + pl(pr.owner) + " (" + esc(pr.reason) + ")" : esc(pr.flag)}` : "Waits for the firm's answer."}</p>
    <div class="lbl">History</div>${S.audit.filter(e => e.pid === pid && e.text.includes(u.topic)).map(e => `<p class="small">${e.at} · ${esc(e.actor)}: ${esc(e.text.slice(0, 100))}</p>`).join("") || `<p class="small muted">Not changed yet.</p>`}`;
  }
  return `<div class="scrim light" onclick="A.close()"></div><aside class="panel" role="dialog" aria-modal="true"><button class="icon close" aria-label="Close" onclick="A.close()">✕</button>${body}</aside>`;
}

function modal() {
  if (!S.modal) return "";
  const m = S.modal; let body = "";
  if (m.kind === "ideas") {
    const pid = S.r[1]; const p = pilot(pid); const r = run(pid); const n = st => r.ideas.filter(u => u.status === st).length;
    body = `<h2>Confirm the ideas</h2><p>${n("kept")} kept as use cases, ${n("merged")} merged, ${n("dropped")} dropped. ${r.questions.length} questions go into the plan for ${pl(p.ae)} to ask the firm.</p>
      <ul class="plain">${r.ideas.filter(u => u.status === "kept").map(u => `<li><b>${esc(u.name)}</b> <span class="small muted">${esc(u.practice)}</span></li>`).join("")}</ul>
      <div class="lbl">What this confirm writes</div><ul class="plain">${confirmWrites("ideas", p, r, { by: me() }).map(w => `<li>${chip(w.target)} ${esc(w.what)}</li>`).join("")}</ul>
      <p class="small muted">Task owners are confirmed separately by ${esc(ROLES.esm.name)}. Nothing goes to the firm.</p>
      <div class="row end"><button class="btn" onclick="A.closeModal()">Cancel</button><button class="btn primary" onclick="A.doConfirmIdeas()">Confirm ideas</button></div>`;
  }
  if (m.kind === "ideasDone") {
    const pid = S.r[1]; const c = conf(pid).ideas;
    body = `<h2>✓ Plan agreed</h2>${c.writes.map(w => `<p class="small">${chip("✓ Done", "green")} <b>${w.target}:</b> ${esc(w.what)}</p>`).join("")}
    <div class="slack"><div class="small muted">Slack · PilotHQ</div><p class="small">${esc(slackText(pid))}</p></div>
    <div class="row end"><button class="btn" onclick="S.modal=null;go('pilots/${pid}/activity')">See it in Activity</button><button class="btn primary" onclick="A.closeModal()">Done</button></div>`;
  }
  if (m.kind === "assign") {
    const p = pilot(m.pid); const c = capacity(m.pid)[m.w]; const flags = m.w === 0 ? openFlags(m.pid) : [];
    body = `<h2>Assign a Legal Engineer</h2><p>${esc(p.firm)}, week of ${WEEKS[m.w]}: short ${c.need - c.staffed} h for ${esc(c.driver.toLowerCase())}.</p>
    ${flags.length ? `<div class="banner warn small">${PIA} This also gives them the task Pia couldn't find an owner for: <b>${flags.map(f => esc(f.title)).join(", ")}</b> (${esc(flags[0].flag.replace(/^No one/, "no one"))}).</div>` : ""}
    <div class="card flush">${lesFree().map(x => `<div class="row-i">${pl(x.name, true)}<span class="small muted grow">${esc(x.specialities.join(", "))} · ${x.free} h free</span><button class="btn small primary" onclick="A.confirmAssign('${jq(x.name)}')">Assign</button></div>`).join("")}</div>
    <div class="row end"><button class="btn" onclick="A.closeModal()">Cancel</button></div>`;
  }
  if (m.kind === "digest") {
    const d = m.i >= 0 ? DIGESTS[m.i] : { week: "Week of 16 Nov", sent: "Draft, posts Monday 08:00", items: S.pilots.map(p => [p.firm, STAGES[stageOf(p.id)], nextStep(p), riskOf(p)[0]]) };
    body = `<h2>${m.i < 0 ? PIA + " " : ""}Weekly digest</h2><p class="small muted">${d.week} · #growth-pilots · ${d.sent}</p>
    <div class="slack ${m.i < 0 ? "pia-card" : ""}"><p><b>Pilots this week</b></p>${d.items.map(([f, st, ch, r]) => `<p class="small"><b>${esc(f)}</b> · ${esc(st)} · ${esc(ch)} · risk ${esc(r)}</p>`).join("")}</div>
    ${m.i < 0 ? `<p class="small muted">${PIA} Drafted by Pia from this week's activity.</p>` : ""}
    <div class="row end"><button class="btn primary" onclick="A.closeModal()">Close</button></div>`;
  }
  if (m.kind === "agenda") {
    body = `<h2>${PIA} Kickoff agenda</h2>${chip(PIA + " Drafted by Pia", "pia")}
    <ol class="small"><li>Introductions and the firm's goals (Priya Raman)</li><li>The use cases Tom agreed, and who sets each one up</li><li>Training plan: London and Singapore together, New York in its own session</li><li>Open questions for the firm</li><li>Readout date and the decision by 31 January</li></ol>
    <p class="small muted">Edit before you send. Pia doesn't send anything.</p><div class="row end"><button class="btn primary" onclick="A.closeModal()">Done</button></div>`;
  }
  return `<div class="scrim" onclick="if(event.target===this)A.closeModal()"><div class="modal" role="dialog" aria-modal="true">${body}</div></div>`;
}

function demoPanel() {
  const hv = pilot("hv");
  return `<div class="demo ${S.demoOpen ? "" : "closed"}"><button class="row between dhead" onclick="A.demo()"><b class="small">Simulate events</b><span class="small muted">${S.demoOpen ? "Hide" : "Show"}</span></button>
  ${S.demoOpen ? `<p class="small muted">Trigger what would normally come from Salesforce, Gong or the model. All firms and people are fictional.</p>
    <button class="btn small full" ${hv.stage !== "Proof of value" ? "disabled" : ""} onclick="A.stageChange()">Salesforce: move Harrow & Vale to pilot stage</button>
    <button class="btn small full" ${hv.stage === "Proof of value" || conf("hv").ideas || (S.anim && S.anim.pid === "hv") ? "disabled" : ""} onclick="A.stageAgain()">Salesforce: same stage change again</button>
    <button class="btn small full" ${S.g2Landed ? "disabled" : ""} onclick="A.landCall()">Gong: follow-up call lands</button>
    <label class="small row"><input type="checkbox" ${S.modelDown ? "checked" : ""} onchange="A.toggleModel()"> Model outage</label>
    <button class="btn small full ghost" onclick="A.reset()">Start again</button>` : ""}</div>`;
}
function toasts() { return `<div class="toasts" aria-live="polite">${S.toasts.map(t => `<div class="toast ${t.kind}">${t.kind === "pia" ? PIA + " " : ""}${esc(t.msg)}${t.undo ? ` <a class="undo" onclick="A.undo('${t.id}')">Undo</a>` : ""}</div>`).join("")}</div>`; }

// ---------- acceptance checks (run the real engine, and the real confirm actions, on fresh copies) ----------
const AC_DEFS = [
  "One run ends waiting for people, with piaVersion on it",
  "Every idea resolves to a sentence in a consented call",
  "The invented idea is removed by the source check",
  "Gap follow-up: one idea gets a quote found in another call; one becomes a question for the Account Executive; the trace shows both searches",
  "Owner proposal matches speciality and has 4+ free hours; one task has no owner and is flagged",
  "No time works for the training session; Pia proposes a split; every proposed slot passes the slot check",
  "A run stops cleanly at the 10-step cap (forced low cap)",
  "Calls without consent are skipped",
  "No recorded calls: nothing drafted",
  "Someone outside the deal team can't open the pilot",
  "Model down: run stops cleanly, nothing written",
  "Nothing is written before a person confirms; each confirm writes only its own piece",
  "Re-run after a new call keeps Tom's edits and marks what changed",
  "Repeat trigger is skipped with a reason",
  "Every read, decision, check and confirmation is in the activity log"
];
// Runs fn against a throwaway app state with a fresh Harrow & Vale run, then puts the real state back.
function sandbox(fn) {
  const saved = S; S = freshState(); S.role = "le";
  try {
    const p = pilot("hv"); p.stage = "Pilot: design";
    const r = runPia(p, { kind: "stage", now: 0 }); r.version = 1; S.runs.hv = [r];
    for (const st of r.steps) { const a = stepAudit("hv", st); log("hv", a.actor, a.type, a.text); }
    return fn(r, p);
  } finally { S = saved; }
}
function runAcceptanceChecks() {
  const hv = clone(PILOTS.find(p => p.id === "hv")), nh = clone(PILOTS.find(p => p.id === "nh")), bw = clone(PILOTS.find(p => p.id === "bw"));
  hv.stage = "Pilot: design";
  const r1 = runPia(hv);
  const checks = [
    () => [r1.status === "waiting" && r1.piaVersion === PIA_VERSION && r1.steps.at(-1).kind === "person", `${r1.piaVersion}, ${r1.steps.length} steps, ${r1.toolSteps} of ${r1.maxSteps} tool steps, ends "${r1.steps.at(-1).label}"`],
    () => [r1.ideas.length > 0 && r1.ideas.every(u => sourceCheck(u.cite, r1.read).ok && CALLS[u.cite.call].consent), `${r1.ideas.length} of ${r1.ideas.length} ideas resolve to a sentence in a consented call`],
    () => [r1.removed.some(x => x.id === "i-spa") && !r1.ideas.some(u => u.id === "i-spa"), `Removed: ${r1.removed.map(x => x.text + " (" + x.why + ")").join("; ")}`],
    () => { const lease = r1.ideas.find(u => u.id === "i-lease"); const q = r1.questions.find(x => x.ideaId === "i-emp"); const tr = r1.steps.filter(s => s.kind === "decision" && /Looked in/.test(s.detail));
      return [lease.followUp && lease.followUp.cite.call !== lease.cite.call && !!q && tr.some(s => /found in/.test(s.detail)) && tr.some(s => /not found, question added/.test(s.detail)), `Lease review: found in ${lease.followUp && lease.followUp.from}. Employment: question for ${hv.ae}. ${tr.length} searches in the trace`]; },
    () => { const own = r1.proposals.filter(p => p.owner); const fl = r1.proposals.filter(p => !p.owner);
      const okOwn = own.length > 0 && own.every(p => PERSON[p.owner].specialities.includes(p.practice) && p.freeAt >= MIN_FREE);
      return [okOwn && fl.length >= 1 && fl.every(f => /No one with .* has time this week/.test(f.flag)) && r1.steps.some(s => s.label === "Propose task owners" && s.detail.includes(ROLES.esm.name)), `${own.map(p => p.owner + " (" + p.reason + ")").join(", ")}; flagged: ${fl.map(f => f.flag).join(", ")}`]; },
    () => { const sc = r1.schedule; const none = proposeSlots(hv.calendar).length === 0;
      return [none && sc.fallback === "split" && sc.sessions.length === 2 && sc.sessions.every(s => s.slots.length && slotCheck(s).ok), `Finder found no time; split into ${sc.sessions.map(s => s.label + " (" + s.slots.length + " slots)").join(" and ")}; all pass the slot check`]; },
    () => { const r = runPia(hv, { maxSteps: 4 }); return [r.status === "stopped" && r.toolSteps === 4 && r.steps.at(-1).label === "Stopped at the step limit" && r.ideas.length > 0, `Cap 4: stopped after ${r.toolSteps} steps, kept ${r.ideas.length} ideas. Full run uses ${r1.toolSteps} of ${MAX_STEPS}`]; },
    () => { const r = runPia(bw); return [r.skipped.includes("gb1") && !r.ideas.some(u => u.cite.call === "gb1") && r.steps[1].status === "warn", r.steps[1].detail]; },
    () => { const r = runPia(nh); return [r.status === "nothing" && r.ideas.length === 0 && r.toolSteps === 0, r.steps.at(-1).detail]; },
    () => [!canView("out", hv) && canView("le", hv) && canView("esm", hv) && !canView("aie", hv), "Lars Berg (not on the deal) is refused; Tom Achebe can open it"],
    () => { const r = runPia(hv, { modelDown: true }); return [r.status === "failed" && r.ideas.length === 0 && r.proposals.length === 0 && /retry/i.test(r.steps.at(-1).detail), "Stopped before reading; no ideas, no proposals, nothing written, retry offered"]; },
    () => sandbox(r => {
      const before = S.writes.length; const readOnly = Object.values(TOOLS).every(t => t.readOnly);
      r.ideas.forEach(u => { u.status = "kept"; u.name = u.text; }); confirmIdeasCore("hv");
      const afterIdeas = S.writes.slice(before); const tasksAfterIdeas = S.extraTasks.length;
      confirmOwnersCore("hv"); const afterOwners = S.writes.slice(before + afterIdeas.length);
      const ok = readOnly && before === 0 && afterIdeas.length && afterIdeas.every(w => w.piece === "ideas") && tasksAfterIdeas === 0 && afterOwners.length && afterOwners.every(w => w.piece === "owners") && S.extraTasks.length > 0;
      return [ok, `0 writes before any confirm; Tom's confirm wrote ${afterIdeas.map(w => w.target).join(" and ")}; Dana's wrote ${S.extraTasks.length} tasks only. All ${Object.keys(TOOLS).length} tools read-only`];
    }),
    () => { const prev = clone(r1); const l = prev.ideas.find(u => u.id === "i-lease"); l.text = "Lease review: break clauses only"; l.edited = true; l.status = "kept"; l.name = "Break clause review";
      const r2 = mergeRun(prev, runPia(hv, { extraCalls: ["g2"] })); const l2 = r2.ideas.find(u => u.id === "i-lease");
      return [l2.text === l.text && l2.name === "Break clause review" && r2.changes.length > 0 && r2.ideas.some(u => u.change === "found"), `Tom's edit kept; changes: ${r2.changes.join("; ")}`]; },
    () => { const r = runPia(hv, { kind: "stage", now: 300, history: [{ kind: "stage", stage: hv.stage, at: 0, status: "waiting", version: 1 }] }); return [r.status === "skipped" && !!r.reason && r.toolSteps === 0, `Skipped: ${r.reason}`]; },
    () => sandbox(r => {
      r.ideas.forEach(u => { u.status = "kept"; u.name = u.text; }); confirmIdeasCore("hv"); confirmOwnersCore("hv");
      const types = new Set(S.audit.map(e => e.type)); const need = ["read", "decision", "check", "confirm"];
      return [need.every(t => types.has(t)) && S.audit.filter(e => e.type !== "confirm" && e.type !== "write" && e.actor !== "Slack").length === r.steps.length, `${S.audit.length} log entries: ${need.map(t => t + " " + S.audit.filter(e => e.type === t).length).join(", ")}`];
    })
  ];
  return checks.map(fn => { try { const [pass, evidence] = fn(); return { pass: !!pass, evidence }; } catch (e) { return { pass: false, evidence: "Error: " + e.message }; } });
}

S = freshState(); seed(); route();
