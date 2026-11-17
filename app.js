// PilotHQ UI. Plain JavaScript, no build step. State lives in memory. Hash routing: #/work, #/pilots/hv/progress, ...

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const jq = s => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const BASE = Date.UTC(2026, 10, 18, 9, 41, 0);
const PERSON = Object.fromEntries(PEOPLE.map(p => [p.name, p]));
const NAV = {
  le: [["work", "My work"], ["approvals", "Approvals"], ["pilots", "Pilots"], ["library", "Pilot Library"], ["people", "People"]],
  ae: [["pilots", "My pilots"], ["work", "My work"], ["library", "Pilot Library"], ["people", "People"]],
  esm: [["pilots", "Portfolio"], ["work", "My work"], ["approvals", "Approvals"], ["library", "Pilot Library"], ["people", "People"]],
  aie: [["quality", "Quality"], ["library", "Pilot Library"], ["people", "People"]],
  out: [["work", "My work"], ["pilots", "Pilots"], ["library", "Pilot Library"], ["people", "People"]]
};
const LANDING = { le: "work", ae: "pilots", esm: "pilots", aie: "quality", out: "work" };
const PILOT_TABS = [["overview", "Overview"], ["progress", "Progress"], ["usecases", "Use cases"], ["gaps", "Gaps"], ["dummy", "Dummy data"], ["schedule", "Schedule"], ["team", "Team"], ["activity", "Activity"]];
let S;

function freshState() {
  return {
    role: "le", r: [], pilots: clone(PILOTS), runs: {}, approved: {}, audit: [], clock: 0,
    modelDown: false, g2Landed: false, anim: null, panel: null, modal: null, toasts: [],
    notes: {}, selectedSlot: {}, testRun: null, acResults: null, demoOpen: true, priority: {},
    done: {}, extraTasks: [], apDone: {}, apFilter: "All", capAdd: {}, piaOpen: true, navOpen: false, q: "", libFilter: "All", actFilter: "All"
  };
}
function stamp() { S.clock += 3 + Math.floor(Math.random() * 6); return new Date(BASE + S.clock * 1000).toISOString().slice(11, 19); }
function log(pid, actor, type, text) { S.audit.push({ at: stamp(), pid, actor, type, text }); }
function pilot(id) { return S.pilots.find(p => p.id === id); }
function run(pid) { const r = S.runs[pid]; return r ? r[r.length - 1] : null; }
function me() { return ROLES[S.role].name; }
function toast(msg, kind = "", undo = null) { const id = Math.random(); S.toasts.push({ id, msg, kind, undo }); setTimeout(() => { S.toasts = S.toasts.filter(t => t.id !== id); render(); }, 4500); }
function go(h) { if (location.hash === "#/" + h) route(); else location.hash = "#/" + h; }

function stepAudit(pid, st) {
  const type = st.kind === "ai" ? (/^(Read|Search|Plan)/.test(st.label) ? "read" : "draft") : st.label === "Start" ? "start" : st.kind === "fixed" ? "check" : "approval";
  const actor = st.kind === "fixed" ? "PilotHQ checks (code)" : st.kind === "ai" ? "Pia (service account, deal team only)" : "PilotHQ";
  return { actor, type, text: `${st.label}: ${st.detail}` };
}

function seed() {
  for (const id of ["nh", "bw"]) {
    const r = runPia(pilot(id), { trigger: "Deal reached pilot stage in Salesforce" }); r.version = 1; S.runs[id] = [r];
    for (const st of r.steps) { const a = stepAudit(id, st); log(id, a.actor, a.type, a.text); }
  }
  S.clock += 600;
}

// ---------- derived data ----------
function tasks() { return [...TASKS, ...S.extraTasks].filter(t => !t.after || (t.after === "run" ? (run(t.pid) && run(t.pid).status === "ready") : S.approved[t.pid])); }
function capacity(pid) { const c = CAPACITY[pid]; const add = S.capAdd[pid] || {}; return c.need.map((n, w) => ({ need: n, staffed: c.staffed[w] + (add[w] || 0), driver: c.driver[w] })); }
function stageOf(pid) { if (pid === "hv") return S.approved.hv ? 3 : run("hv") ? 1 : 0; return PROGRESS[pid].current; }
function riskOf(p) {
  const c0 = capacity(p.id)[0]; const short = c0.need - c0.staffed;
  if (p.id === "cr") return short > 0 ? ["High", "Short of Legal Engineer hours; 3 criteria not agreed"] : ["Medium", "3 success criteria not agreed"];
  if (p.id === "lh") return ["Low", ""];
  const r = run(p.id);
  if (r && r.status === "nothing") return ["Medium", "No recorded calls yet"];
  if (short > 0) return ["Medium", `Short of ${short} Legal Engineer hours this week`];
  return ["Low", ""];
}
function nextStep(p) {
  if (p.id === "lh") return "Week 4 usage review, 26 Nov";
  if (p.id === "cr") return "Run the overdue first training";
  const r = run(p.id);
  if (S.anim && S.anim.pid === p.id) return "Pia is drafting";
  if (!r) return "Waiting for pilot stage in Salesforce";
  if (r.status === "nothing") return "Book and record a discovery call";
  if (r.status === "failed") return "Retry Pia's run";
  if (S.approved[p.id]) return "Send the first training invite";
  return "Legal Engineer to approve Pia's draft";
}
function approvals() {
  const items = [];
  if (S.role === "le") {
    const r = run("hv");
    if (r && r.status === "ready" && !S.approved.hv && !(S.anim && S.anim.pid === "hv")) items.push({ id: "hv-plan", pia: true, type: "Pilot plan", pid: "hv", text: r.changes && r.changes.length ? `Pia's updated draft after the follow-up call: ${r.changes.length} changes` : `Pia's draft plan: ${r.useCases.length} use cases, ${r.gaps.length} questions`, age: "Just now", review: "pilots/hv/usecases" });
    items.push({ id: "lib-l031", pia: true, type: "Library entry", pid: null, text: "De-identified plan from a finished UK funds pilot, ready to add to the library", age: "2 days" });
  }
  if (S.role === "esm") {
    items.push({ id: "staff-cr", type: "Staffing", pid: "cr", text: "Castellan & Rowe is short 12 Legal Engineer hours this week. Add Ravi Menon for 12 h.", age: "1 day", apply: () => addCap("cr", 0, 12, "Ravi Menon") });
    items.push({ id: "staff-hv", type: "Staffing", pid: "hv", text: "Harrow & Vale is short 4 Legal Engineer hours this week. Add Mei Tan for 4 h.", age: "3 hours", apply: () => addCap("hv", 0, 4, "Mei Tan") });
  }
  return items.filter(i => !S.apDone[i.id]);
}
function addCap(pid, w, h, who) {
  S.capAdd[pid] = S.capAdd[pid] || {}; S.capAdd[pid][w] = (S.capAdd[pid][w] || 0) + h;
  S.extraTasks.push({ id: "x" + Math.random().toString(36).slice(2, 7), pid, stage: stageOf(pid), title: `Join ${pilot(pid).firm} for ${h} h: ${CAPACITY[pid].driver[w].toLowerCase()}`, owner: who, due: "Week of " + WEEKS[w], dueDay: 5 + w * 7, assignedBy: me() });
  const p = pilot(pid); if (!p.team.includes(who)) p.team.push(who);
  log(pid, me(), "edit", `Assigned ${who} for ${h} h in the week of ${WEEKS[w]}`);
}
function visiblePeople() { return PEOPLE.filter(p => p.org === "ABC Inc." || canView(S.role, pilot(p.org))); }

// ---------- actions ----------
const A = {
  role(r) { S.role = r; S.panel = null; S.modal = null; S.navOpen = false; go(LANDING[r]); },
  stageChange() {
    const p = pilot("hv"); if (p.stage !== "Proof of value") return;
    p.stage = "Pilot: design"; log("hv", "Salesforce", "start", "Stage changed from Proof of value to Pilot");
    toast("Salesforce: Harrow & Vale moved to Pilot. Pia started a run.");
    if (canView(S.role, p)) go("pilots/hv/usecases");
    startRun("hv", { trigger: "Deal reached pilot stage in Salesforce" });
  },
  landCall() {
    if (S.g2Landed) return; S.g2Landed = true; const p = pilot("hv");
    log("hv", "Gong", "start", "New call landed: Follow-up call, 18 Nov 2026"); p.calls.push("g2");
    if (S.approved.hv) { toast("New call landed after approval. Pia did not re-run; Tom was told."); log("hv", "PilotHQ", "check", "Pilot already approved, so no re-run. Legal Engineer notified."); render(); return; }
    if (!run("hv") || run("hv").status !== "ready") { toast("Gong: follow-up call landed. Pia will read it on the next run."); render(); return; }
    toast("Gong: follow-up call landed. Pia is re-running.");
    startRun("hv", { trigger: "New call landed in Gong before approval (Follow-up call, 18 Nov)", merge: true });
  },
  reread(pid) { log(pid, me(), "start", "Asked Pia to re-read the calls"); startRun(pid, { trigger: "Re-read requested by " + me(), merge: true }); },
  toggleModel() { S.modelDown = !S.modelDown; toast(S.modelDown ? "Model outage on: the next run will fail cleanly." : "Model back online."); render(); },
  retry(pid) { log(pid, me(), "start", "Retry requested"); startRun(pid, { trigger: "Retry by " + me() }); },
  reset() { const role = S.role; S = freshState(); S.role = role; seed(); go(LANDING[role]); toast("Started again."); },
  demo() { S.demoOpen = !S.demoOpen; render(); },
  pia() { S.piaOpen = !S.piaOpen; render(); },
  nav() { S.navOpen = !S.navOpen; render(); },
  person(n) { S.q = ""; S.panel = { kind: "person", name: n }; render(); },
  call(call, i) {
    S.panel = { kind: "call", call, i }; const pid = S.r[0] === "pilots" ? S.r[1] : S.r[0] === "firms" ? S.r[1] : null;
    if (pid) log(pid, me(), "read", `Viewed ${CALLS[call].source} ${CALLS[call].title.toLowerCase()}${i != null ? " at " + CALLS[call].lines[i].t : ""}`);
    render(); setTimeout(() => { const el = document.querySelector(".tline.hl"); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); }, 30);
  },
  uc(id) { S.panel = { kind: "uc", id }; render(); },
  close() { S.panel = null; render(); },
  setStatus(id, st) {
    const pid = S.r[1]; const u = run(pid).useCases.find(x => x.id === id); const was = u.status; u.status = u.status === st ? "draft" : st;
    log(pid, me(), "approval", `${u.status === "draft" ? "Reset" : st === "accepted" ? "Accepted" : "Rejected"} use case: ${u.title}`);
    if (u.status === "rejected") toast("Use case rejected.", "", () => { u.status = was; });
    render();
  },
  editCrit(id, el) {
    const pid = S.r[1]; const r = run(pid); const u = r.useCases.find(x => x.id === id); const v = el.value.trim();
    if (v === (u.criterion ? u.criterion.text : "")) return;
    u.criterion = { text: v, cite: u.criterion ? u.criterion.cite : null, editedBy: me() }; u.edited = true;
    log(pid, me(), "edit", `Edited success criterion for "${u.title}": "${v}"`);
    const g = r.gaps.find(x => x.id === "gap-" + id); if (g && v) { r.gaps = r.gaps.filter(x => x !== g); toast("Gap closed: success criterion added."); }
    render();
  },
  answer(id, el) { const pid = S.r[1]; const g = run(pid).gaps.find(x => x.id === id); if (g.answer === el.value) return; g.answer = el.value; log(pid, me(), "edit", `Answered: ${g.text.slice(0, 60)}... -> "${el.value}"`); },
  redraft(id) {
    const pid = S.r[1]; const d = run(pid).dummy[id]; const p = pilot(pid);
    log(pid, me(), "draft", "Asked Pia to redraft blocked dummy data");
    d.docs = d.redraft || d.docs; d.hits = d.docs.flatMap(doc => dealFactScreen(doc.title + " " + doc.body, p)); d.status = d.hits.length ? "blocked" : "draft";
    log(pid, "Pia (service account, deal team only)", "draft", "Redrafted dummy data with invented names");
    log(pid, "PilotHQ checks (code)", "check", d.hits.length ? "Deal-fact screen blocked the redraft again" : "Deal-fact screen passed on the redraft");
    toast(d.hits.length ? "Still blocked." : "Pia's redraft passed the deal-fact screen.", d.hits.length ? "bad" : "pia"); render();
  },
  editDoc(id, k, el) { const pid = S.r[1]; const d = run(pid).dummy[id]; const t = el.innerText.trim(); if (t === d.docs[k].body) return; d.docs[k].body = t; d.edited = true; d.hits = dealFactScreen(t, pilot(pid)); d.status = d.hits.length ? "blocked" : "draft"; log(pid, me(), "edit", "Edited dummy document: " + d.docs[k].title); render(); },
  slot(i) { S.selectedSlot[S.r[1]] = i; render(); },
  copyInvite() { const t = document.getElementById("invite").innerText; try { navigator.clipboard.writeText(t); } catch (e) {} log(S.r[1], me(), "send", "Copied the drafted invite to send from their own calendar"); if (S.role === "ae" && S.approved.hv) S.done.t4 = true; toast("Invite copied. Send it from your own calendar."); render(); },
  note(el) { const v = el.value.trim(); if (!v) return; const pid = S.r[1]; S.notes[pid] = (S.notes[pid] || []).concat({ by: me(), text: v }); log(pid, me(), "edit", "Added context for Pia: " + v); toast("Saved. Pia reads this on the next run."); render(); },
  approve() { S.modal = { kind: "approve" }; render(); },
  closeModal() { S.modal = null; render(); },
  confirmApprove() {
    const pid = S.r[1]; const p = pilot(pid); const r = run(pid); const lvl = editLevel(r);
    log(pid, me(), "approval", `Approved the plan (${lvl.toLowerCase()})`);
    r.useCases.forEach(u => { if (u.status === "draft") u.status = "accepted"; });
    const writes = approvalWrites(p, r);
    S.approved[pid] = { by: me(), level: lvl, writes }; S.done.t1 = true; S.done.t2 = true; p.stage = "Pilot: approved";
    for (const w of writes) log(pid, "PilotHQ (after approval)", "write", `${w.target}: ${w.what}`);
    S.modal = { kind: "approved" }; render();
  },
  task(id) { S.done[id] = !S.done[id]; const t = tasks().find(x => x.id === id); log(t.pid, me(), "edit", `${S.done[id] ? "Completed" : "Reopened"} task: ${t.title}`); if (S.done[id]) toast("Task done.", "", () => { S.done[id] = false; }); render(); },
  agenda() { S.modal = { kind: "agenda" }; log("hv", "Pia (service account, deal team only)", "draft", "Drafted the kickoff agenda from the approved plan"); render(); },
  ap(id, verdict) {
    const it = approvals().find(x => x.id === id); if (!it) return; S.apDone[id] = verdict;
    if (verdict === "approved" && it.apply) it.apply();
    log(it.pid, me(), "approval", `${verdict === "approved" ? "Approved" : "Rejected"}: ${it.text}`);
    if (id === "staff-cr") S.done.t10 = true;
    toast(verdict === "approved" ? "Approved." : "Rejected."); render();
  },
  apFilter(f) { S.apFilter = f; render(); },
  assign(pid, w) { S.modal = { kind: "assign", pid, w }; render(); },
  confirmAssign(who) { const { pid, w } = S.modal; const c = capacity(pid)[w]; addCap(pid, w, c.need - c.staffed, who); S.modal = null; toast(`${who} assigned to ${pilot(pid).firm}.`); render(); },
  priority(pid, el) { S.priority[pid] = el.value; log(pid, me(), "edit", "Priority set to " + el.value); toast("Priority updated."); },
  libFilter(f) { S.libFilter = f; render(); },
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
  let r = runPia(p, { trigger: opts.trigger, modelDown: S.modelDown });
  if (opts.merge && prev && prev.status === "ready" && r.status === "ready") r = mergeRun(clone(prev), r);
  r.version = (S.runs[pid] || []).length + 1;
  S.runs[pid] = (S.runs[pid] || []).concat(r);
  S.anim = { pid, shown: 0 }; S.piaOpen = true; render();
  const t = setInterval(() => {
    const st = r.steps[S.anim.shown]; const a = stepAudit(pid, st); log(pid, a.actor, a.type, a.text);
    S.anim.shown++;
    if (S.anim.shown >= r.steps.length) { clearInterval(t); S.anim = null; if (r.status === "ready") toast(r.changes && r.changes.length ? `Pia updated the draft: ${r.changes.length} changes.` : "Pia's draft is ready for review.", "pia"); if (r.status === "failed") toast("Run stopped cleanly. Nothing was written.", "bad"); }
    render();
  }, 480);
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
function pilotLink(pid, label) { return `<a class="ent" onclick="go('pilots/${pid}/overview')">${esc(label || pilot(pid).firm)}</a>`; }
function libLink(id) { return `<a class="ent" onclick="go('library/${id}')">${id}</a>`; }
function practiceLink(pr) { return `<a class="ent subtle" onclick="S.libFilter='${jq(pr)}';go('library')">${esc(pr)}</a>`; }
function chip(t, k = "") { return `<span class="chip ${k}">${t}</span>`; }
const PIA = `<span class="spark" aria-hidden="true">✦</span>`;
function piaBtn(label, on, extra = "") { return `<button class="btn pia" ${extra} onclick="${on}">${PIA} ${esc(label)}</button>`; }
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
      <div class="search"><input id="q" placeholder="Search" value="${esc(S.q)}" oninput="A.search(this)" aria-label="Search pilots, people and library"><div id="sres"></div></div>
      <button class="icon bell" aria-label="Notifications" onclick="go('${ap ? "approvals" : LANDING[S.role]}')">🔔${ap ? `<span class="dotn">${ap}</span>` : ""}</button>
      <label class="who">${av(me(), "sm")}<select aria-label="Switch role" onchange="A.role(this.value)">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === S.role ? "selected" : ""}>${esc(v.name)} · ${esc(v.label)}</option>`).join("")}</select></label>
    </div></header>`;
}
function renderSearch() {
  const box = document.getElementById("sres"); if (!box) return;
  const q = S.q.trim().toLowerCase(); if (q.length < 2) { box.innerHTML = ""; return; }
  const ps = S.pilots.filter(p => canView(S.role, p) && p.firm.toLowerCase().includes(q)).map(p => `<a onclick="S.q='';go('pilots/${p.id}/overview')"><span class="chip">Pilot</span> ${esc(p.firm)}</a>`);
  const pe = visiblePeople().filter(p => p.name.toLowerCase().includes(q)).map(p => `<a onclick="A.person('${jq(p.name)}')"><span class="chip">Person</span> ${esc(p.name)}</a>`);
  const li = LIBRARY.filter(e => (e.id + " " + e.useCase + " " + e.summary).toLowerCase().includes(q)).map(e => `<a onclick="S.q='';go('library/${e.id}')"><span class="chip">Library</span> ${esc(e.useCase)}</a>`);
  const all = [...ps, ...pe, ...li].slice(0, 8);
  box.innerHTML = `<div class="sres">${all.join("") || `<span class="small muted">No results</span>`}</div>`;
}

function main() {
  const [a, b, c] = S.r;
  if (a === "work") return workView();
  if (a === "approvals") return approvalsView();
  if (a === "pilots" && b) return pilotView(b, c || "overview");
  if (a === "pilots") return S.role === "esm" ? portfolioView() : pilotsView();
  if (a === "library") return b ? libEntryView(b) : libraryView();
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
  return `<div class="ph"><div><div class="eyebrow">My work</div><h1>Good morning, ${esc(me().split(" ")[0])}</h1><p class="muted">${mine.filter(t => !S.done[t.id]).length} open tasks${ap.length ? ` · ${ap.length} waiting for your approval` : ""}</p></div></div>
  <div class="grid2 wide-l">
    <section>${groups.map(([g, f]) => { const ts = mine.filter(f); if (!ts.length && g !== "Today") return ""; return `<h3 class="sect">${g} <span class="count">${ts.length}</span></h3><div class="card flush">${ts.map(taskRow).join("") || `<div class="empty-s">Nothing due today.</div>`}</div>`; }).join("")}</section>
    <aside>
      ${ap.length ? `<h3 class="sect">Waiting for you</h3><div class="card flush">${ap.map(i => `<div class="row-i ${i.pia ? "pia-l" : ""}"><div>${i.pia ? chip(PIA + " Pia", "pia") : chip(i.type)} <b>${i.pid ? esc(pilot(i.pid).firm) : "Pilot Library"}</b><div class="small">${esc(i.text)}</div></div><a class="ent small" onclick="go('${i.review || "approvals"}')">Open</a></div>`).join("")}</div>` : ""}
      <h3 class="sect">Recent Pia activity</h3><div class="card flush">${recent.map(e => `<div class="row-i pia-l"><div><div class="small muted">${e.at} · ${esc(pilot(e.pid).firm)}</div><div class="small">${esc(e.text)}</div></div></div>`).join("") || `<div class="empty-s">Pia hasn't run on your pilots today.</div>`}</div>
    </aside></div>`;
}
function taskRow(t) {
  const done = !!S.done[t.id]; const p = t.pid ? pilot(t.pid) : null;
  const open = t.route ? `go('${t.route}')` : t.tab ? `go('pilots/${t.pid}/${t.tab}')` : t.pid ? `go('pilots/${t.pid}/progress')` : "";
  const canTick = t.owner === me();
  return `<div class="task ${done ? "done" : ""}"><input type="checkbox" class="tick" ${done ? "checked" : ""} ${canTick ? "" : "disabled"} onchange="A.task('${t.id}')" aria-label="Mark done: ${esc(t.title)}">
    <div class="grow"><a class="ent" onclick="${open}">${esc(t.title)}</a><div class="small muted">${p ? pilotLink(p.id) + " · " : ""}Due ${esc(t.due)}${t.assignedBy ? " · assigned by " + pl(t.assignedBy) : ""}</div></div>
    ${t.pia && !done ? piaBtn("Draft it", "A.agenda()") : ""}${pl(t.owner) === esc(t.owner) ? "" : `<span title="${esc(t.owner)}">${av(t.owner, "sm")}</span>`}</div>`;
}

// ---------- Approvals ----------
function approvalsView() {
  const f = S.apFilter;
  const items = approvals().filter(i => f === "All" || (f === "Drafted by Pia" && i.pia) || (f === "Staffing" && i.type === "Staffing") || (f === "Library" && i.type === "Library entry"));
  return `<div class="ph"><div><div class="eyebrow">Approvals</div><h1>Waiting for your decision</h1><p class="muted">Nothing Pia drafts is saved until a person approves it.</p></div></div>
  <div class="filters">${["All", "Drafted by Pia", "Staffing", "Library"].map(x => `<button class="fchip ${f === x ? "on" : ""}" onclick="A.apFilter('${x}')">${x}</button>`).join("")}</div>
  <div class="card flush">${items.map(i => `<div class="appr ${i.pia ? "pia-l" : ""}">
     <div class="grow"><div class="row">${i.pia ? chip(PIA + " Drafted by Pia", "pia") : chip("Requested by " + (i.type === "Staffing" ? "PilotHQ capacity check" : "team"))}<span class="small muted">${esc(i.type)} · ${esc(i.age)}</span></div>
       <div class="mt4"><b>${i.pid ? fl(i.pid) : "Pilot Library"}</b></div><div>${esc(i.text)}</div></div>
     <div class="row">${i.review ? `<button class="btn primary" onclick="go('${i.review}')">Review</button>` : `<button class="btn" onclick="A.ap('${i.id}','rejected')">Reject</button><button class="btn primary" onclick="A.ap('${i.id}','approved')">Approve</button>`}</div></div>`).join("") || `<div class="empty"><h3>Nothing waiting for you</h3><p class="muted">New drafts from Pia and staffing requests appear here.</p></div>`}</div>`;
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
  <h3 class="sect">Capacity coming up</h3><p class="small muted">Legal Engineer hours staffed of needed, per pilot. Hover for what drives the need; click a short week to assign someone.</p>
  <div class="card flush"><table class="tbl cap"><thead><tr><th>Pilot</th>${WEEKS.map(w => `<th>${w}</th>`).join("")}</tr></thead><tbody>
  ${all.map(p => `<tr><td><a class="ent" onclick="go('pilots/${p.id}/overview')">${esc(p.firm)}</a></td>${capacity(p.id).map((c, w) => { const short = c.need - c.staffed; const cls = c.need === 0 ? "none" : short <= 0 ? "ok" : short > c.need / 2 ? "bad" : "short"; return `<td><button class="cell ${cls}" title="${esc(c.driver)}" ${short > 0 ? `onclick="A.assign('${p.id}',${w})"` : "disabled"}><b>${c.staffed}/${c.need}</b><span>${short > 0 ? "short " + short : c.need ? "covered" : "none"}</span></button></td>`; }).join("")}</tr>`).join("")}
  <tr class="tot"><td>Total short</td>${WEEKS.map((w, i) => `<td>${all.reduce((a, p) => a + Math.max(0, capacity(p.id)[i].need - capacity(p.id)[i].staffed), 0)} h</td>`).join("")}</tr>
  </tbody></table></div></section>
  <aside><h3 class="sect">My tasks</h3><div class="card flush">${myTasks.map(taskRow).join("") || `<div class="empty-s">All done.</div>`}</div>
  <h3 class="sect">Waiting for approval</h3><div class="card flush">${approvals().map(i => `<div class="row-i"><div class="small">${esc(i.text)}</div><button class="btn small primary" onclick="A.ap('${i.id}','approved')">Approve</button></div>`).join("") || `<div class="empty-s">Nothing waiting.</div>`}</div></aside></div>`;
}
function criteriaSummary(p) {
  const pr = PROGRESS[p.id];
  if (pr.criteria) return `${pr.criteria.filter(c => !/^Not agreed/.test(c[0])).length} of ${pr.criteria.length} agreed`;
  const r = run(p.id); if (!r || r.status !== "ready") return "None yet";
  const k = r.useCases.filter(u => u.status !== "rejected");
  return S.approved[p.id] ? `${k.filter(u => u.criterion && u.criterion.text).length} of ${k.length} agreed` : `${k.filter(u => u.criterion).length} drafted by Pia`;
}

// ---------- Pilot workspace ----------
function pilotView(pid, tab) {
  const p = pilot(pid);
  if (!p) return `<div class="empty card"><h3>Pilot not found</h3></div>`;
  if (!canView(S.role, p)) return `<div class="empty card"><h2>You don't have access to this pilot</h2><p class="muted">${esc(me())} is not on the deal team, so PilotHQ shows nothing about it. Pia's service account only reads the deal team's records. This attempt is in the activity log.</p><button class="btn" onclick="go('${LANDING[S.role]}')">Back</button></div>`;
  const r = run(pid); const anim = S.anim && S.anim.pid === pid;
  const blocked = r && r.status === "ready" ? Object.values(r.dummy).filter(d => d.status === "blocked").length : 0;
  let action = "";
  if (S.approved[pid]) action = chip("✓ Approved by " + esc(S.approved[pid].by), "green big");
  else if (S.role === "le" && r && r.status === "ready" && !anim) action = `<button class="btn primary big" ${blocked ? "disabled" : ""} onclick="A.approve()">Approve plan</button>${blocked ? `<div class="small badc">Resolve ${blocked} blocked draft first</div>` : ""}`;
  else if (r && r.status === "ready" && !anim) action = `<span class="small muted">Waiting for ${pl(p.les[0])} to approve</span>`;
  const count = k => { if (k === "progress") { const n = tasks().filter(t => t.pid === pid && !S.done[t.id] && t.stage === stageOf(pid)).length; return n || ""; } if (!r || r.status !== "ready") return ""; if (k === "usecases") return r.useCases.length; if (k === "gaps") return r.gaps.length || ""; if (k === "dummy") return blocked ? `<span class="badge">${blocked}</span>` : ""; return ""; };
  const tabName = (PILOT_TABS.find(t => t[0] === tab) || [0, "Overview"])[1];
  const showPia = S.piaOpen && !p.static;
  return `<div class="crumbs"><a class="ent subtle" onclick="go('pilots')">${S.role === "esm" ? "Portfolio" : "Pilots"}</a> / ${fl(pid)} / <span class="muted">${tabName}</span></div>
  <div class="ph pilot-h"><div><h1>${esc(p.firm)}</h1>
    <div class="row wrap small muted">${chip(esc(STAGES[stageOf(pid)]))}<span>${esc(p.region)}</span>·<span>${p.users} users</span>·<span>${p.days} days</span>·<span>AE ${pl(p.ae)}</span>·<span>LE ${p.les.map(n => pl(n)).join(", ")}</span></div></div>
    <div class="actions">${action}${p.static ? "" : `<button class="btn pia ghost" onclick="A.pia()" aria-expanded="${S.piaOpen}">${PIA} ${S.piaOpen ? "Hide" : "Show"} Pia</button>`}</div></div>
  ${anim ? `<div class="piabar" aria-label="Pia is working"><span></span></div>` : ""}
  <nav class="ptabs" role="tablist">${PILOT_TABS.map(([k, l]) => `<a role="tab" tabindex="0" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}" onclick="go('pilots/${pid}/${k}')" onkeydown="if(event.key==='Enter')go('pilots/${pid}/${k}')">${l}${count(k) !== "" ? ` <span class="count">${count(k)}</span>` : ""}</a>`).join("")}</nav>
  ${r && r.changes && r.changes.length && !anim && !S.approved[pid] ? `<div class="banner pia-b">${PIA} <b>Pia updated the draft after the follow-up call.</b> Your edits were kept. ${r.changes.map(esc).join(" · ")}</div>` : ""}
  <div class="work ${showPia ? "with-pia" : ""}"><section class="tabbody">${tabBody(p, r, anim, tab)}</section>${showPia ? `<aside class="piapanel">${piaPanel(p, r, anim)}</aside>` : ""}</div>`;
}

function tabBody(p, r, anim, tab) {
  if (tab === "overview") return overviewTab(p, r);
  if (tab === "progress") return progressTab(p);
  if (tab === "team") return teamTab(p);
  if (tab === "activity") return activityTab(p);
  if (p.static) return `<div class="empty card"><h3>Planned by hand</h3><p class="muted">This pilot was set up before Pia. See Progress and Team.</p></div>`;
  if (anim) return `<div class="card">${[1, 2, 3, 4].map(() => `<div class="skel"></div>`).join("")}<p class="small muted">${PIA} Pia is reading and drafting. Nothing shows until the source check and deal-fact screen have run.</p></div>`;
  if (!r) return `<div class="empty card"><h3>Nothing drafted yet</h3><p class="muted">Pia drafts the plan when the deal reaches pilot stage in Salesforce.</p></div>`;
  if (r.status === "nothing") return `<div class="empty card"><h3>Nothing to read</h3><p class="muted">This pilot has no recorded calls Pia is allowed to read, so Pia drafted nothing rather than guessing.</p></div>`;
  if (r.status === "failed") return `<div class="empty card"><h3>Pia's run stopped</h3><p class="muted">The model did not respond. Nothing was half-written. ${S.role === "le" ? "Try again from the Pia panel." : "The Legal Engineer has been told to retry."}</p></div>`;
  if (tab === "usecases") return useCasesTab(p, r);
  if (tab === "gaps") return gapsTab(p, r);
  if (tab === "dummy") return dummyTab(p, r);
  if (tab === "schedule") return scheduleTab(p, r);
  return "";
}

function overviewTab(p, r) {
  const pr = PROGRESS[p.id]; const s = stageOf(p.id); const f = FIRMS[p.id];
  const kept = r && r.status === "ready" ? r.useCases.filter(u => u.status !== "rejected") : [];
  const next = tasks().filter(t => t.pid === p.id && !S.done[t.id]).slice(0, 4);
  const gaps = r && r.status === "ready" ? r.gaps.length : 0;
  return `<div class="ov">
   <div class="card"><div class="lbl">How it's tracking</div>${miniStepper(p.id)}
     <div class="kv"><span>Stage</span><b>${esc(STAGES[s])}</b><span>Days left</span><b>${pr.daysLeft}</b><span>Firm decides</span><b>${esc(pr.decision)}</b><span>Success criteria</span><b>${esc(criteriaSummary(p))}</b><span>Open gaps</span><b>${gaps ? `<a class="ent" onclick="go('pilots/${p.id}/gaps')">${gaps}</a>` : "0"}</b><span>Risk</span><b>${riskChip(riskOf(p)[0])}</b></div>
     <a class="ent small" onclick="go('pilots/${p.id}/progress')">Progress and checklist →</a></div>
   <div class="card"><div class="lbl">Firm</div><h3>${fl(p.id)}</h3><p class="small">${esc(f.about)}</p>
     <div class="kv"><span>HQ</span><b>${esc(f.hq)}</b><span>Offices</span><b>${f.offices.map(esc).join(", ")}</b><span>Lawyers</span><b>${f.lawyers}</b><span>Pilot</span><b>${p.users} users · ${p.days} days</b>${(S.role === "ae" || S.role === "esm") && p.salesforce ? `<span>Deal</span><b>${esc(p.salesforce.amount)}</b>` : ""}</div></div>
   <div class="card ${!p.static && kept.length && !S.approved[p.id] ? "pia-card" : ""}"><div class="row between"><div class="lbl">What's agreed</div>${!p.static && kept.length ? draftTag(p.id) : ""}</div>${p.static ? (pr.criteria || []).map(c => `<p class="small">• ${esc(c[0])}</p>`).join("") : kept.length ? `<ul class="plain">${kept.map(u => `<li><a class="ent" onclick="A.uc('${u.id}')">${esc(u.title)}</a><div class="small muted">${practiceLink(u.practice)} · ${u.criterion && u.criterion.text ? esc(u.criterion.text) : "success criterion to agree"}</div></li>`).join("")}</ul>` : `<p class="small muted">Nothing agreed yet.</p>`}</div>
   <div class="card"><div class="lbl">What's next</div>${next.map(t => `<div class="row-i nb"><a class="ent small" onclick="go('pilots/${p.id}/progress')">${esc(t.title)}</a><span class="row small muted nowrap">${esc(t.due)} ${av(t.owner, "sm")}</span></div>`).join("") || `<p class="small muted">No open tasks.</p>`}
     ${S.role === "ae" && !p.static ? `<div class="lbl mt12">Add context for Pia</div><textarea id="note" rows="2" placeholder="e.g. The firm's champion moves to Singapore in December."></textarea><button class="btn small mt4" onclick="A.note(document.getElementById('note'))">Save</button>${(S.notes[p.id] || []).map(n => `<p class="small">• ${esc(n.text)}</p>`).join("")}` : ""}</div>
   <div class="card span2"><div class="row between"><div class="lbl">Team</div><a class="ent small" onclick="go('pilots/${p.id}/team')">Workstreams and DRIs →</a></div><div class="row wrap">${p.team.map(n => `<span class="person-chip">${pl(n, true)}<span class="small muted">${esc(PERSON[n] ? PERSON[n].title : "")}</span></span>`).join("")}</div></div>
   <div class="card span2"><div class="lbl">Sources Pia reads</div><div class="row wrap">${SOURCES.map(([n, what, t]) => `<button class="src-chip" onclick="S.actFilter='${n}';go('pilots/${p.id}/activity')"><b>${n}</b><span class="small muted">${what} · ${t}</span></button>`).join("")}</div></div>
  </div>`;
}
function miniStepper(pid) { const s = stageOf(pid); const bl = PROGRESS[pid].blocked; return `<div class="mini" aria-label="Stage ${s + 1} of ${STAGES.length}">${STAGES.map((st, i) => `<span class="${i < s ? "d" : i === s ? (bl ? "b" : "c") : ""}" title="${esc(st)}"></span>`).join("")}</div>`; }

function progressTab(p) {
  const pr = PROGRESS[p.id]; const s = stageOf(p.id);
  const dates = p.id === "hv" ? pr.dates.map((d, i) => (i === 2 || i === 1) && !S.approved.hv && !run("hv") ? "Planned" : d) : pr.dates;
  const cl = tasks().filter(t => t.pid === p.id && t.stage === s);
  const r = run(p.id);
  const crit = pr.criteria || (r && r.status === "ready" ? r.useCases.filter(u => u.status !== "rejected").map(u => [u.criterion && u.criterion.text ? u.criterion.text : `Not agreed: ${u.practice} measure`, S.approved[p.id] ? "Not started" : "Draft"]) : []);
  const warn = ["hv", "lh", "cr"].includes(p.id);
  return `<div class="card"><ol class="stepper">${STAGES.map((st, i) => { const state = i < s ? "done" : i === s ? (pr.blocked ? "blocked" : "current") : "up"; return `<li class="${state}"><span class="sdot">${state === "done" ? "✓" : state === "blocked" ? "!" : i + 1}</span><div><b>${i === 1 && !p.static ? PIA + " " : ""}${esc(st)}</b><div class="small muted">${esc(dates[i] || "")}</div><div class="small">${pr.owners[i] && PERSON[pr.owners[i]] ? pl(pr.owners[i]) : esc(pr.owners[i] || "")}</div></div></li>`; }).join("")}</ol>
    <div class="row wrap small mt12">${chip(pr.daysLeft + " days left")}<span>Readout ${esc(pr.readout)}</span>·<span>Firm decides ${esc(pr.decision)}</span></div>
    ${warn ? `<div class="banner warn small mt12">The readout is less than two weeks before the firm decides. Consider moving it earlier.</div>` : ""}</div>
  <div class="grid2"><section><h3 class="sect">Checklist: ${esc(STAGES[s])} <span class="count">${cl.filter(t => !S.done[t.id]).length} open</span></h3>
   <div class="card flush">${cl.map(taskRow).join("") || `<div class="empty-s">No tasks for this stage.</div>`}</div></section>
   <section><h3 class="sect">Success criteria</h3><div class="card flush">${crit.map(([c, st]) => `<div class="row-i"><span class="small">${esc(c)}</span>${chip(st === "Draft" ? PIA + " Draft" : st, st === "Met" ? "green" : st === "On track" ? "blue" : st === "At risk" ? "red" : st === "Draft" ? "pia" : "")}</div>`).join("") || `<div class="empty-s">Agreed once the plan is approved.</div>`}</div></section></div>`;
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
  const filters = ["All", "Pia", "Checks", "People", "Digests", ...SOURCES.map(s => s[0])];
  let rows = S.audit.filter(e => e.pid === p.id);
  if (f === "Pia") rows = rows.filter(e => e.actor.startsWith("Pia"));
  else if (f === "Checks") rows = rows.filter(e => e.type === "check");
  else if (f === "People") rows = rows.filter(e => PERSON[e.actor]);
  else if (f !== "All" && f !== "Digests") rows = rows.filter(e => (e.actor + " " + e.text).includes(f));
  return `<div class="filters">${filters.map(x => `<button class="fchip ${f === x ? "on" : ""}" onclick="A.actFilter('${x}')">${x}</button>`).join("")}</div>
  ${f === "Digests" ? digestsList() : auditTable(rows, true)}`;
}
function digestsList() {
  return `<div class="row between"><p class="small muted">Weekly digest, posted to #growth-pilots every Monday at 08:00.</p>${piaBtn("Preview next digest", "A.digest(-1)")}</div>
  <div class="card flush">${DIGESTS.map((d, i) => `<div class="row-i click" onclick="A.digest(${i})"><div><b>${d.week}</b><div class="small muted">#growth-pilots · sent ${d.sent} · ${d.items.length} pilots</div></div><span class="ent small">Open</span></div>`).join("")}</div>`;
}
function auditTable(rows, inPilot) {
  const icon = { start: "▶", read: "📖", draft: "✎", check: "✓", approval: "👤", edit: "✎", write: "⤓", send: "✉", access: "⛔" };
  return `<div class="card flush"><table class="tbl audit"><thead><tr><th>Time</th>${inPilot ? "" : "<th>Pilot</th>"}<th>Who</th><th>Type</th><th>What</th></tr></thead><tbody>
  ${rows.slice().reverse().map(e => `<tr class="${e.actor.startsWith("Pia") ? "pia-row" : ""}"><td class="mono small">${e.at}</td>${inPilot ? "" : `<td class="small">${esc(pilot(e.pid) ? pilot(e.pid).firm : "")}</td>`}<td class="small">${e.actor.startsWith("Pia") ? chip(PIA + " Pia", "pia") : PERSON[e.actor] ? pl(e.actor) : esc(e.actor)}</td><td>${chip((icon[e.type] || "") + " " + e.type)}</td><td class="small">${esc(e.text)}</td></tr>`).join("") || `<tr><td colspan="5"><div class="empty-s">Nothing logged yet.</div></td></tr>`}
  </tbody></table></div>`;
}

function srcLink(cite, label = "Source") {
  if (!cite) return "";
  const l = lineAt(cite); const c = CALLS[cite.call];
  const i = l.text.toLowerCase().indexOf(cite.quote.toLowerCase());
  const html = i < 0 ? esc(l.text) : esc(l.text.slice(0, i)) + "<mark>" + esc(l.text.slice(i, i + cite.quote.length)) + "</mark>" + esc(l.text.slice(i + cite.quote.length));
  return `<span class="src" tabindex="0" aria-label="Source">❝${label === "icon" ? "" : " " + label}<span class="hovercard"><span class="small muted">${c.source} · ${esc(c.title)} · ${c.date} · ${l.t}</span><span class="quote">“${html}”</span><span class="small">${pl(l.who)}</span><button class="btn small" onclick="A.call('${cite.call}',${cite.i})">View in call</button></span></span>`;
}
function draftTag(pid) { return S.approved[pid] ? chip("✓ Approved by " + esc(S.approved[pid].by) + ", 18 Nov", "green") : chip(PIA + " Drafted by Pia", "pia"); }

function useCasesTab(p, r) {
  const editable = S.role === "le" && !S.approved[p.id];
  const st = { draft: ["Draft", "pia"], accepted: ["✓ Accepted", "green"], rejected: ["✕ Rejected", "red"] };
  return `<div class="row between"><p class="small muted">Hover ❝ to see the sentence each use case came from. Click a use case for detail.</p>${draftTag(p.id)}</div>
  <div class="card flush ${S.approved[p.id] ? "" : "pia-card"}"><table class="tbl uc"><thead><tr><th>Use case</th><th>Practice</th><th>Success criterion</th><th>Past pilot</th><th>Status</th></tr></thead><tbody>
  ${r.useCases.map(u => `<tr class="${u.status}">
    <td><a class="ent uct" onclick="A.uc('${u.id}')">${esc(u.title)}</a> ${srcLink(u.cite, "icon")}<div class="small muted">${esc(u.feature)} ${u.change === "new" ? chip("New", "pia") : u.change === "changed" ? chip("Changed", "pia") : u.change === "kept" ? chip("Your edits kept") : ""}</div></td>
    <td>${practiceLink(u.practice)}</td>
    <td>${editable ? `<textarea rows="2" aria-label="Success criterion" placeholder="Not in the calls. Add one or ask the firm." onchange="A.editCrit('${u.id}',this)">${esc(u.criterion ? u.criterion.text : "")}</textarea>` : `<div>${u.criterion && u.criterion.text ? esc(u.criterion.text) : `<span class="badc">Not in the calls</span>`}</div>`}
      <div class="small muted">${u.criterion && u.criterion.cite ? srcLink(u.criterion.cite) : ""} ${u.edited ? "Edited by you" : ""} ${u.change === "changed" ? `Was: ${esc(u.was)}` : ""}</div></td>
    <td>${u.library ? `${libLink(u.library.id)} ${chip(u.library.score >= 80 ? "Strong" : "Partial", u.library.score >= 80 ? "green" : "")}<div class="small muted">${esc(u.library.entry.configured)}</div>` : `<span class="small muted">No match</span>`}</td>
    <td>${chip(st[u.status][0], st[u.status][1])}${editable ? `<div class="row small-gap"><button class="icon ok" aria-label="Accept" title="Accept" onclick="A.setStatus('${u.id}','accepted')">✓</button><button class="icon no" aria-label="Reject" title="Reject" onclick="A.setStatus('${u.id}','rejected')">✕</button></div>` : ""}</td></tr>`).join("")}
  </tbody></table></div>
  ${r.removed.length ? `<details class="card soft"><summary><b>${r.removed.length} removed by the source check</b> <span class="small muted">before anyone saw them</span></summary>${r.removed.map(x => `<p class="small"><s>${esc(x.title)}</s> · ${esc(x.why)}</p>`).join("")}</details>` : ""}
  ${r.skipped && r.skipped.length ? `<div class="banner warn small">Skipped ${r.skipped.length} call because the firm has not agreed to AI processing.</div>` : ""}`;
}
function gapsTab(p, r) {
  const editable = S.role === "le" && !S.approved[p.id];
  if (!r.gaps.length) return `<div class="empty card"><h3>No open questions</h3><p class="muted">Pia asks here when the calls don't cover something.</p></div>`;
  return `<p class="small muted">Where the calls don't say, Pia asks instead of guessing.</p>
  ${r.gaps.map(g => `<div class="card pia-card"><div class="row between">${chip(PIA + " " + esc(g.kind), "pia")}${srcLink(g.cite)}</div><p>${esc(g.text)}</p>
   ${editable ? `<textarea rows="2" aria-label="Answer" placeholder="Your answer, or leave it for ${esc(p.ae)} to chase" onchange="A.answer('${g.id}',this)">${esc(g.answer)}</textarea>` : g.answer ? `<p class="small"><b>Answer:</b> ${esc(g.answer)}</p>` : `<p class="small muted">To chase: ${pl(p.ae)}</p>`}</div>`).join("")}`;
}
function dummyTab(p, r) {
  const editable = S.role === "le" && !S.approved[p.id];
  return `<p class="small muted">First drafts, all invented. Every draft runs through the deal-fact screen before you see it.</p>
  ${r.useCases.filter(u => r.dummy[u.id]).map(u => { const d = r.dummy[u.id]; return `<div class="card ${d.status === "blocked" ? "blocked" : S.approved[p.id] ? "" : "pia-card"}">
    <div class="row between"><b>${esc(u.title)}</b>${d.status === "blocked" ? chip("✕ Blocked", "red") : draftTag(p.id)}</div><p class="small">${esc(d.brief)}</p>
    ${d.status === "blocked" ? `<div class="banner bad small"><b>Blocked by the deal-fact screen.</b> ${d.hits.map(h => `"${esc(h.term)}" is a ${esc(h.kind)} (found by ${h.by}, from Salesforce)`).join("; ")}. Hidden so it can't be copied into the pilot.</div>
      <div class="doc blur" aria-hidden="true">${esc(d.docs[0].body)}</div>${editable ? piaBtn("Ask Pia to redraft with invented names", `A.redraft('${u.id}')`) : ""}`
    : d.docs.map((doc, k) => `<div class="doc"><div class="doctitle">${esc(doc.title)} ${chip("Invented")}</div><div class="docbody" ${editable ? `contenteditable="true" onblur="A.editDoc('${u.id}',${k},this)"` : ""}>${esc(doc.body)}</div></div>`).join("")}</div>`; }).join("")}`;
}
function scheduleTab(p, r) {
  const cal = p.calendar; if (!cal || !r.slots.length) return `<div class="empty card"><h3>No slots proposed</h3><p class="muted">Pia proposes slots once the plan is drafted.</p></div>`;
  const sel = S.selectedSlot[p.id] ?? 0; const s = r.slots[sel]; const people = [...cal.internal, ...cal.firm];
  const invite = `To: Priya Raman, Wei Ling Ho (Harrow & Vale); Tom Achebe, Mei Tan (ABC Inc.)
Subject: Pilot: first training session for banking associates
When: ${s.day} ${s.date}, ${s.local.find(x => x.city === "London").time} London / ${s.local.find(x => x.city === "Singapore").time} Singapore (60 min)

Hi Priya and Wei Ling,

As agreed, we'd like to start the pilot with the banking associates in London and Singapore. This first session covers facility agreement review, using invented agreements only.

Does this time work for you? Happy to move it.

Sofia`;
  return `<div class="card pia-card"><div class="row between"><b>${esc(cal.session)}</b>${srcLink(cal.sessionCite)}</div>
    <p class="small muted">${PIA} Pia proposed these from the team's free/busy and the firm's working hours.</p>
    <table class="tbl slots"><thead><tr><th></th><th>Slot</th>${people.map(x => `<th>${pl(x.name)}<div class="small muted">${x.city}</div></th>`).join("")}</tr></thead><tbody>
    ${r.slots.map((sl, i) => `<tr class="click ${i === sel ? "sel" : ""}" onclick="A.slot(${i})"><td><input type="radio" name="slot" aria-label="Choose ${sl.day} ${sl.date}" ${i === sel ? "checked" : ""}></td><td><b>${sl.day} ${sl.date}</b></td>${sl.local.map(x => `<td>${x.time}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
  <div class="card pia-card"><div class="row between"><b>Invite</b>${chip(PIA + " Drafted by Pia", "pia")}</div><pre id="invite" class="invite">${esc(invite)}</pre>
    <button class="btn ${S.role === "ae" ? "primary" : ""}" onclick="A.copyInvite()">Copy invite to send from my calendar</button></div>`;
}

function piaPanel(p, r, anim) {
  const head = `<div class="row between"><h3 class="piah">${PIA} Pia</h3><button class="icon" aria-label="Close Pia panel" onclick="A.pia()">✕</button></div><p class="small muted">The agent reads and drafts. People approve.</p>`;
  if (!r) return head + `<div class="empty-s">Pia hasn't run on this pilot yet. It starts when the deal reaches pilot stage in Salesforce.</div>`;
  const shown = anim ? S.anim.shown : r.steps.length;
  const tag = { fixed: ["Check", ""], ai: [PIA + " Pia", "pia"], person: ["Person", "green"] };
  const icon = { ok: "✓", warn: "!", blocked: "✕", error: "✕", stop: "■", wait: "…" };
  const canAct = S.role === "le" && !S.approved[p.id] && !anim;
  return head + `<div class="small muted">Run ${r.version}${S.runs[p.id].length > 1 ? " of " + S.runs[p.id].length : ""} · ${r.read.length} calls read</div>
   <ol class="steps">${r.steps.map((st, i) => { const state = i < shown ? st.status : i === shown && anim ? "running" : "pending"; return `<li class="st ${state} k-${st.kind}"><span class="dot">${state === "running" ? `<span class="spin"></span>` : state === "pending" ? "" : icon[st.status]}</span><div><div class="row between"><b class="small">${esc(st.label)}</b>${chip(tag[st.kind][0], tag[st.kind][1])}</div>${i < shown ? `<div class="small muted">${esc(st.detail)}</div>${st.tool ? `<span class="tool small">${esc(st.tool)}</span>` : ""}` : ""}</div></li>`; }).join("")}</ol>
   <div class="stack">${r.status === "failed" && S.role === "le" && !anim ? piaBtn("Ask Pia to try again", `A.retry('${p.id}')`) : ""}
   ${canAct && r.status === "ready" ? piaBtn("Ask Pia to re-read the calls", `A.reread('${p.id}')`) : ""}
   <button class="btn pia" disabled title="Coming later">${PIA} Ask Pia about this pilot</button></div>`;
}

// ---------- Library, people, firm ----------
function libraryView() {
  const practices = ["All", ...new Set(LIBRARY.map(e => LIB_EXTRA[e.id].practice))];
  const list = LIBRARY.filter(e => S.libFilter === "All" || LIB_EXTRA[e.id].practice === S.libFilter);
  return `<div class="ph"><div><div class="eyebrow">Pilot Library</div><h1>What worked before</h1><p class="muted">De-identified past pilots. Pia searches these when it drafts a new plan.</p></div></div>
  <div class="filters">${practices.map(x => `<button class="fchip ${S.libFilter === x ? "on" : ""}" onclick="A.libFilter('${jq(x)}')">${esc(x)}</button>`).join("")}</div>
  <div class="cards">${list.map(e => { const used = matchedBy(e.id); return `<div class="card click libcard" onclick="go('library/${e.id}')"><div class="row between"><span class="small muted mono">${e.id}</span>${chip(esc(LIB_EXTRA[e.id].practice))}</div><h3>${esc(e.useCase)}</h3><p class="small muted">${esc(e.summary)}</p><p class="small">${esc(e.configured)}</p>${used.length ? `<div class="small pia-t">${PIA} Pia matched this in ${used.map(esc).join(", ")}</div>` : ""}</div>`; }).join("") || `<div class="empty-s">No entries for this practice yet.</div>`}</div>`;
}
function matchedBy(id) { const out = []; for (const [pid, rs] of Object.entries(S.runs)) { const r = rs[rs.length - 1]; if (r.useCases.some(u => u.library && u.library.id === id) && canView(S.role, pilot(pid))) out.push(pilot(pid).firm); } return out; }
function libEntryView(id) {
  const e = LIBRARY.find(x => x.id === id); if (!e) return `<div class="empty card"><h3>Not found</h3></div>`;
  const used = matchedBy(id);
  return `<div class="crumbs"><a class="ent subtle" onclick="go('library')">Pilot Library</a> / <span class="muted">${id}</span></div>
  <div class="ph"><div><div class="eyebrow">${esc(LIB_EXTRA[id].practice)} · ${id}</div><h1>${esc(e.useCase)}</h1><p class="muted">${esc(e.summary)} · de-identified</p></div></div>
  <div class="grid2"><div class="card"><div class="lbl">What was configured</div><p>${esc(e.configured)}</p><div class="lbl">Outcome</div><p>${esc(LIB_EXTRA[id].outcome)}</p></div>
  <div class="card"><div class="lbl">Reused in current pilots</div>${used.length ? used.map(f => `<p class="pia-t">${PIA} ${esc(f)}</p>`).join("") : `<p class="small muted">Not matched in a current pilot yet.</p>`}</div></div>`;
}
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
  <div class="grid2"><div class="card"><div class="lbl">Profile</div><div class="kv"><span>HQ</span><b>${esc(f.hq)}</b><span>Offices</span><b>${f.offices.map(esc).join(", ")}</b><span>Lawyers</span><b>${f.lawyers}</b></div><div class="lbl">Practice areas</div><div class="row wrap">${f.practices.map(x => chip(practiceLink(x))).join("")}</div></div>
  <div class="card"><div class="lbl">Contacts</div>${contacts.map(c => `<div class="row-i nb">${pl(c.name, true)}<span class="small muted">${esc(c.title)}</span></div>`).join("") || `<p class="small muted">No contacts recorded yet.</p>`}</div>
  <div class="card"><div class="lbl">Pilot</div><p>${pilotLink(pid, "Open the pilot")} · ${p.users} users · ${p.days} days</p>${progressBar(pid)}</div>
  <div class="card"><div class="lbl">Calls</div>${(p.calls || []).map(c => `<div class="row-i nb"><a class="ent" onclick="A.call('${c}',null)">${CALLS[c].source} · ${esc(CALLS[c].title)}</a><span class="small muted">${CALLS[c].date}${CALLS[c].consent ? "" : " · no AI consent"}</span></div>`).join("") || `<p class="small muted">No recorded calls.</p>`}
  ${p.salesforce && (S.role === "ae" || S.role === "esm") ? `<div class="lbl mt12">Deal</div><p class="small">${esc(p.salesforce.opportunity)} · ${esc(p.salesforce.amount)} · closes ${esc(p.salesforce.closeDate)}</p>` : ""}</div></div>`;
}

// ---------- Quality (AI Enablement) ----------
function qualityView(tab) {
  const tabs = [["checks", "Acceptance checks"], ["tests", "Test set"], ["runs", "Pia's runs"], ["health", "Connections"], ["log", "Activity log"]];
  return `<div class="ph"><div><div class="eyebrow">Quality</div><h1>Is Pia safe and working?</h1><p class="muted">Pia runs on every pilot, for every team. This is where you check it.</p></div></div>
  <nav class="ptabs">${tabs.map(([k, l]) => `<a class="${tab === k ? "on" : ""}" onclick="go('quality/${k}')">${l}</a>`).join("")}</nav>
  ${tab === "checks" ? acView() : tab === "tests" ? testView() : tab === "runs" ? runLog() : tab === "health" ? healthView() : auditTable(S.audit, false)}`;
}
function acView() {
  const res = S.acResults; const passed = res ? res.filter(r => r.pass).length : 0;
  return `<div class="row between"><p class="muted small">Each acceptance criterion, run against the current version of Pia.</p><button class="btn primary" onclick="A.runChecks()">Run all 12 checks</button></div>
  ${res ? `<div class="banner ${passed === res.length ? "good" : "bad"}">${passed} of ${res.length} acceptance criteria pass</div>` : ""}
  <div class="card flush"><table class="tbl"><thead><tr><th>#</th><th>Given</th><th>When</th><th>Then</th><th>Result</th></tr></thead><tbody>
  ${AC_DEFS.map((d, i) => { const r = res && res[i]; return `<tr><td><b>${d.id}</b></td><td class="small">${esc(d.given)}</td><td class="small">${esc(d.when)}</td><td class="small">${esc(d.then)}</td><td>${r ? `${chip(r.pass ? "✓ Pass" : "✕ Fail", r.pass ? "green" : "red")}<div class="small muted">${esc(r.evidence)}</div>` : `<span class="small muted">Not run</span>`}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function testView() {
  const t = S.testRun; const n = t ? t.n : 0; const rows = TEST_SET.slice(0, n);
  const lab = rows.reduce((a, r) => a + r[2], 0), found = rows.reduce((a, r) => a + r[3], 0), inv = rows.reduce((a, r) => a + r[4], 0);
  const pct = lab ? Math.round(found / lab * 100) : 0; const done = t && t.done;
  return `<div class="row between"><p class="muted small">24 past pilots labelled by Legal Engineers. Pass mark: at least 80% found and none invented. A failure blocks release.</p><button class="btn primary" onclick="A.runTests()">Run test set</button></div>
  <div class="tiles"><div class="tile"><span class="lbl">Found</span><b>${t ? pct + "%" : "–"}</b><span class="small muted">${t ? `${found} of ${lab}` : "target 80%"}</span></div><div class="tile"><span class="lbl">Invented</span><b>${t ? inv : "–"}</b><span class="small muted">target 0</span></div><div class="tile"><span class="lbl">Deal facts in dummy data</span><b>${t ? 0 : "–"}</b><span class="small muted">target 0</span></div><div class="tile"><span class="lbl">Release gate</span><b>${done ? (pct >= 80 && inv === 0 ? `<span class="okc">✓ Pass</span>` : `<span class="badc">Blocked</span>`) : t ? "Running" : "–"}</b></div></div>
  <div class="card flush"><table class="tbl"><thead><tr><th>Past pilot</th><th>Practice (de-identified)</th><th>Labelled</th><th>Found</th><th>Invented</th><th></th></tr></thead><tbody>
  ${rows.map(r => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${chip(Math.round(r[3] / r[2] * 100) + "%", r[3] / r[2] >= 0.8 ? "green" : "warn")}</td></tr>`).join("") || `<tr><td colspan="6"><div class="empty-s">Not run yet.</div></td></tr>`}</tbody></table></div>`;
}
function runLog() {
  const all = []; for (const [pid, rs] of Object.entries(S.runs)) rs.forEach(r => all.push({ pid, r }));
  return `<div class="card flush"><table class="tbl"><thead><tr><th>Run</th><th>Pilot</th><th>Trigger</th><th>Status</th><th>Sources</th><th>Kept / removed</th><th>Blocked</th><th>Cost</th></tr></thead><tbody>
  ${all.map(({ pid, r }) => `<tr><td>v${r.version}</td><td>${esc(pilot(pid).firm)}</td><td class="small">${esc(r.steps[0].detail)}</td><td>${chip(r.status, r.status === "ready" ? "green" : r.status === "failed" ? "red" : "warn")}</td><td class="small">${r.read.length ? r.read.map(c => CALLS[c].source).join(", ") : "none"}</td><td>${r.useCases.length} / ${r.removed.length}</td><td>${Object.values(r.dummy).filter(d => d.hits && d.hits.length).length}</td><td>${r.status === "ready" ? "$" + (0.9 + 0.25 * r.read.length).toFixed(2) : "$0.00"}</td></tr>`).join("") || `<tr><td colspan="8"><div class="empty-s">No runs yet.</div></td></tr>`}</tbody></table></div>`;
}
function healthView() {
  return `<div class="card flush"><table class="tbl"><thead><tr><th>Connection</th><th>Used for</th><th>Access</th><th>Scope</th><th>Last sync</th><th>Status</th><th></th></tr></thead><tbody>
  ${SOURCES.map(([n, what, t]) => `<tr><td><b>${n}</b></td><td class="small">${what}</td><td class="small">${n === "Slack" || n === "Notion" ? "Writes after approval" : "Reads only"}</td><td class="small">Deal team records only</td><td class="small">${t}</td><td>${chip("✓ Connected", "green")}</td><td><button class="btn small" onclick="toast('Reconnect starts in the real app.')">Reconnect</button></td></tr>`).join("")}</tbody></table></div>`;
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
    ${p.hours ? `<div class="lbl">Capacity this week</div><div class="pbar"><span style="width:${Math.round(p.booked / p.hours * 100)}%"></span></div><div class="small muted">${p.booked} of ${p.hours} h booked</div>` : ""}
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
  if (S.panel.kind === "uc") {
    const pid = S.r[1]; const r = run(pid); const u = r && r.useCases.find(x => x.id === S.panel.id); if (!u) return "";
    const d = r.dummy[u.id]; const l = lineAt(u.cite);
    body = `<div class="lbl">Use case</div><h2>${esc(u.title)}</h2><div class="row wrap">${chip(practiceLink(u.practice))}${chip(esc(u.feature))}${draftTag(pid)}</div>
    <div class="lbl">Where it came from</div><blockquote>“${esc(l.text)}”<div class="small muted">${pl(l.who)} · ${CALLS[u.cite.call].source}, ${l.t}</div></blockquote><button class="btn small" onclick="A.call('${u.cite.call}',${u.cite.i})">View in call</button>
    <div class="lbl">Success criterion</div><p>${u.criterion && u.criterion.text ? esc(u.criterion.text) : `<span class="badc">Not agreed yet</span>`}</p>
    <div class="lbl">Past pilot</div><p>${u.library ? `${libLink(u.library.id)} · ${esc(u.library.entry.configured)}` : "No match"}</p>
    <div class="lbl">Dummy data</div><p class="small">${d ? esc(d.brief) : "None"}</p>
    <div class="lbl">History</div>${S.audit.filter(e => e.pid === pid && e.text.includes(u.title)).map(e => `<p class="small">${e.at} · ${esc(e.actor)}: ${esc(e.text.slice(0, 90))}</p>`).join("") || `<p class="small muted">Drafted by Pia, not edited.</p>`}`;
  }
  return `<div class="scrim light" onclick="A.close()"></div><aside class="panel" role="dialog" aria-modal="true"><button class="icon close" aria-label="Close" onclick="A.close()">✕</button>${body}</aside>`;
}

function modal() {
  if (!S.modal) return "";
  const m = S.modal; let body = "";
  if (m.kind === "approve") {
    const pid = S.r[1]; const p = pilot(pid); const r = run(pid); const kept = r.useCases.filter(u => u.status !== "rejected"); const rej = r.useCases.length - kept.length;
    body = `<h2>Approve the pilot plan</h2><p>${kept.length} use cases${rej ? `, ${rej} rejected` : ""}. ${r.gaps.length} open questions go into the plan for ${pl(p.ae)} to chase.</p>
      <p class="small">Your edits: <b>${editLevel(r)}</b></p><div class="lbl">What will be written</div><ul class="plain">${approvalWrites(p, r).map(w => `<li>${chip(w.target)} ${esc(w.what)}</li>`).join("")}</ul>
      <p class="small muted">Nothing goes to the firm. ${esc(p.ae)} sends the invite.</p>
      <div class="row end"><button class="btn" onclick="A.closeModal()">Cancel</button><button class="btn primary" onclick="A.confirmApprove()">Approve plan</button></div>`;
  }
  if (m.kind === "approved") {
    const pid = S.r[1]; const r = run(pid); const ap = S.approved[pid]; const kept = r.useCases.filter(u => u.status !== "rejected");
    body = `<h2>✓ Plan approved</h2>${ap.writes.map(w => `<p class="small">${chip("✓ Done", "green")} <b>${w.target}:</b> ${esc(w.what)}</p>`).join("")}
    <div class="slack"><div class="small muted">#pilot-hv-harrow · PilotHQ</div><p><b>Harrow & Vale pilot plan approved</b> by ${esc(ap.by)}.<br>${kept.length} use cases: ${kept.map(u => esc(u.practice)).join(", ")}.<br>${r.gaps.length} questions to chase with the firm (Sofia).<br>Next: the kickoff checklist is ready in PilotHQ.</p></div>
    <div class="row end"><button class="btn" onclick="S.modal=null;go('pilots/${pid}/progress')">See progress</button><button class="btn primary" onclick="A.closeModal()">Done</button></div>`;
  }
  if (m.kind === "assign") {
    const p = pilot(m.pid); const c = capacity(m.pid)[m.w]; const les = PEOPLE.filter(x => x.hours).sort((a, b) => (a.booked - b.booked));
    body = `<h2>Assign a Legal Engineer</h2><p>${esc(p.firm)}, week of ${WEEKS[m.w]}: short ${c.need - c.staffed} h for ${esc(c.driver.toLowerCase())}.</p>
    <div class="card flush">${les.map(x => `<div class="row-i">${pl(x.name, true)}<span class="small muted grow">${esc(x.specialities.join(", "))} · ${x.hours - x.booked} h free</span><button class="btn small primary" onclick="A.confirmAssign('${jq(x.name)}')">Assign</button></div>`).join("")}</div>
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
    <ol class="small"><li>Introductions and the firm's goals (Priya Raman)</li><li>Use cases and how each will be judged</li><li>Dummy data: what it is and why no client documents</li><li>Training plan: banking associates first, London and Singapore</li><li>Open questions from the calls</li><li>Readout date and the decision by 31 January</li></ol>
    <p class="small muted">Edit before you send. Pia doesn't send anything.</p><div class="row end"><button class="btn primary" onclick="A.closeModal()">Done</button></div>`;
  }
  return `<div class="scrim" onclick="if(event.target===this)A.closeModal()"><div class="modal" role="dialog" aria-modal="true">${body}</div></div>`;
}

function demoPanel() {
  const hv = pilot("hv");
  return `<div class="demo ${S.demoOpen ? "" : "closed"}"><button class="row between dhead" onclick="A.demo()"><b class="small">Simulate events</b><span class="small muted">${S.demoOpen ? "Hide" : "Show"}</span></button>
  ${S.demoOpen ? `<p class="small muted">Trigger what would normally come from Salesforce, Gong or the model. All firms and people are fictional.</p>
    <button class="btn small full" ${hv.stage !== "Proof of value" ? "disabled" : ""} onclick="A.stageChange()">Salesforce: move Harrow & Vale to pilot stage</button>
    <button class="btn small full" ${S.g2Landed ? "disabled" : ""} onclick="A.landCall()">Gong: follow-up call lands</button>
    <label class="small row"><input type="checkbox" ${S.modelDown ? "checked" : ""} onchange="A.toggleModel()"> Model outage</label>
    <button class="btn small full ghost" onclick="A.reset()">Start again</button>` : ""}</div>`;
}
function toasts() { return `<div class="toasts" aria-live="polite">${S.toasts.map(t => `<div class="toast ${t.kind}">${t.kind === "pia" ? PIA + " " : ""}${esc(t.msg)}${t.undo ? ` <a class="undo" onclick="A.undo('${t.id}')">Undo</a>` : ""}</div>`).join("")}</div>`; }

// ---------- acceptance checks (run the real engine on fresh copies) ----------
const AC_DEFS = [
  { id: "AC1", given: "A deal reaches pilot stage in Salesforce", when: "The stage changes", then: "Pia starts one run and shows the plan to the assigned Legal Engineer" },
  { id: "AC2", given: "A new discovery call lands in Gong or Granola", when: "The pilot is not yet approved", then: "Pia re-runs and marks what changed" },
  { id: "AC3", given: "A drafted use case", when: "The Legal Engineer hovers over it", then: "The source sentence shows, with View in call" },
  { id: "AC4", given: "A use case with no source sentence", when: "The source check runs", then: "It is removed before anyone sees it" },
  { id: "AC5", given: "A draft that names the firm, a client, a matter or a fee", when: "The deal-fact screen runs", then: "The draft is blocked and the Legal Engineer is told why" },
  { id: "AC6", given: "The calls don't cover a practice area or success measure", when: "The agent drafts", then: "It asks a question instead of guessing" },
  { id: "AC7", given: "A pilot with no recorded calls", when: "A run starts", then: "Pia says there is nothing to read and drafts nothing" },
  { id: "AC8", given: "The firm has not agreed to AI processing of a call", when: "A run starts", then: "Pia skips that call and says so" },
  { id: "AC9", given: "A user outside the deal team", when: "They open the pilot", then: "They see nothing" },
  { id: "AC10", given: "The model is unavailable", when: "A run starts", then: "The run stops cleanly, nothing half-written, retry offered" },
  { id: "AC11", given: "The Legal Engineer approves", when: "They click Approve plan", then: "Notion page, dummy data and Slack summary are written" },
  { id: "AC12", given: "Any run", when: "It finishes or fails", then: "Every read, draft, check and approval is logged" }
];
function runAcceptanceChecks() {
  const hv = clone(PILOTS.find(p => p.id === "hv")), nh = clone(PILOTS.find(p => p.id === "nh")), bw = clone(PILOTS.find(p => p.id === "bw"));
  const r1 = runPia(hv);
  const checks = [
    () => [r1.status === "ready" && r1.steps[0].label === "Start" && r1.steps.at(-1).detail.includes(hv.les[0]), `One run, ${r1.steps.length} steps, waiting for ${hv.les[0]}`],
    () => { const r2 = mergeRun(clone(r1), runPia(hv, { extraCalls: ["g2"] })); return [r2.useCases.some(u => u.change === "new") && r2.useCases.some(u => u.change === "changed"), r2.changes.join("; ")]; },
    () => [r1.useCases.length > 0 && r1.useCases.every(u => sourceCheck(u.cite, r1.read).ok && lineAt(u.cite)), `${r1.useCases.length} of ${r1.useCases.length} use cases resolve to a sentence in a call`],
    () => [r1.removed.some(x => x.id === "uc-spa") && !r1.useCases.some(u => u.id === "uc-spa"), `Removed: ${r1.removed.map(x => x.title + " (" + x.why + ")").join("; ")}`],
    () => { const d = r1.dummy["uc-chron"]; const clean = dealFactScreen(d.redraft.map(x => x.title + " " + x.body).join(" "), hv).length === 0; return [d.status === "blocked" && d.hits.some(h => h.term === "Meridian Shipping") && clean, `Blocked on "${d.hits.map(h => h.term).join(", ")}"; redraft passes`]; },
    () => [r1.gaps.some(g => g.id === "gap-uc-dd") && r1.gaps.some(g => g.kind === "Practice with no use case"), `${r1.gaps.length} questions asked`],
    () => { const r = runPia(nh); return [r.status === "nothing" && r.useCases.length === 0, r.steps.at(-1).detail]; },
    () => { const r = runPia(bw); return [r.skipped.includes("gb1") && !r.useCases.some(u => u.cite.call === "gb1") && r.steps[1].status === "warn", r.steps[1].detail]; },
    () => [!canView("out", hv) && canView("le", hv) && canView("esm", hv) && !canView("aie", hv), "Lars Berg (not on the deal) is refused; Tom Achebe can open it"],
    () => { const r = runPia(hv, { modelDown: true }); return [r.status === "failed" && r.useCases.length === 0 && !r.steps.some(s => s.label.startsWith("Draft")) && /retry/i.test(r.steps.at(-1).detail), "Stopped at planning; no drafts, no writes, retry offered"]; },
    () => { const w = approvalWrites(hv, r1); return [w.some(x => x.target === "Notion") && w.some(x => x.target === "Slack") && !("writes" in r1), w.map(x => x.target).join(", ") + "; nothing written before approval"]; },
    () => { const ev = r1.steps.map(st => stepAudit("hv", st)); const types = new Set(ev.map(e => e.type)); return [ev.length === r1.steps.length && ["read", "draft", "check", "approval"].every(t => types.has(t)), `${ev.length} log entries for ${r1.steps.length} steps: ${[...types].join(", ")}`]; }
  ];
  return checks.map(fn => { try { const [pass, evidence] = fn(); return { pass, evidence }; } catch (e) { return { pass: false, evidence: "Error: " + e.message }; } });
}

S = freshState(); seed(); route();
