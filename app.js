// PilotHQ UI. Plain JavaScript, no build step. State lives in memory.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BASE = Date.UTC(2026, 10, 18, 9, 41, 0);
let S;

function freshState() {
  const s = {
    role: "le", view: "home", pid: null, tab: null, aieTab: "checks",
    pilots: clone(PILOTS), runs: {}, approved: {}, audit: [], clock: 0,
    modelDown: false, g2Landed: false, anim: null, drawer: null, modal: null, toasts: [],
    notes: {}, selectedSlot: {}, testRun: null, acResults: null, demoOpen: true, priority: {}
  };
  return s;
}

function stamp() { S.clock += 3 + Math.floor(Math.random() * 6); const d = new Date(BASE + S.clock * 1000); return d.toISOString().slice(11, 19); }
function log(pid, actor, type, text) { S.audit.push({ at: stamp(), pid, actor, type, text }); }
function pilot(id) { return S.pilots.find(p => p.id === id); }
function run(pid) { const r = S.runs[pid]; return r ? r[r.length - 1] : null; }
function toast(msg, kind = "") { const id = Math.random(); S.toasts.push({ id, msg, kind }); setTimeout(() => { S.toasts = S.toasts.filter(t => t.id !== id); render(); }, 4200); }

const STEP_TYPE = { fixed: "check", ai: "read", person: "approval" };
function stepAudit(pid, st) {
  const type = st.kind === "ai" ? (st.label.startsWith("Read") || st.label.startsWith("Search") || st.label.startsWith("Plan") ? "read" : "draft") : st.label === "Start" ? "start" : STEP_TYPE[st.kind];
  const actor = st.kind === "fixed" ? "PilotHQ checks (code)" : st.kind === "ai" ? "Pia (service account, deal team only)" : "PilotHQ";
  return { actor, type, text: `${st.label}: ${st.detail}` };
}

// Seed: Nordhavn and Brightwater ran earlier today.
function seed() {
  for (const id of ["nh", "bw"]) {
    const p = pilot(id); const r = runPia(p, { trigger: "Deal reached pilot stage in Salesforce" }); r.version = 1;
    S.runs[id] = [r];
    for (const st of r.steps) { const a = stepAudit(id, st); log(id, a.actor, a.type, a.text); }
  }
  S.clock += 600;
}

// ---------- actions ----------
const A = {
  role(r) { S.role = r; S.view = "home"; S.pid = null; S.drawer = null; render(); },
  home() { S.view = "home"; S.pid = null; S.drawer = null; render(); },
  open(pid) {
    const p = pilot(pid);
    if (!canView(S.role, p)) { log(pid, ROLES[S.role].name, "access", `Access denied: ${ROLES[S.role].name} is not on the deal team`); S.view = "denied"; S.pid = pid; render(); return; }
    S.view = "pilot"; S.pid = pid; S.tab = S.role === "le" ? "usecases" : "plan"; render();
  },
  tab(t) { S.tab = t; render(); },
  aieTab(t) { S.aieTab = t; render(); },
  stageChange() {
    const p = pilot("hv"); if (p.stage !== "Proof of value") return;
    p.stage = "Pilot: design";
    log("hv", "Salesforce", "start", "Stage changed from Proof of value to Pilot");
    toast("Salesforce: Harrow & Vale moved to Pilot. Pia started a run.");
    startRun("hv", { trigger: "Deal reached pilot stage in Salesforce" });
  },
  landCall() {
    if (S.g2Landed) return;
    S.g2Landed = true; const p = pilot("hv");
    log("hv", "Gong", "start", "New call landed: Follow-up call, 18 Nov 2026");
    if (S.approved.hv) { toast("New call landed after approval. Pia did not re-run; Tom was told."); log("hv", "PilotHQ", "check", "Pilot already approved, so no re-run. Legal Engineer notified of the new call."); p.calls.push("g2"); render(); return; }
    if (!run("hv") || run("hv").status !== "ready") { p.calls.push("g2"); toast("Gong: follow-up call landed. Pia will read it on the next run."); render(); return; }
    p.calls.push("g2");
    toast("Gong: follow-up call landed. Pia is re-running and will mark what changed.");
    startRun("hv", { trigger: "New call landed in Gong before approval (Follow-up call, 18 Nov)", merge: true });
  },
  toggleModel() { S.modelDown = !S.modelDown; toast(S.modelDown ? "Model outage on: the next run will fail cleanly." : "Model back online."); render(); },
  retry(pid) { log(pid, ROLES[S.role].name, "start", "Retry requested"); startRun(pid, { trigger: "Retry by " + ROLES[S.role].name }); },
  reset() { S = freshState(); seed(); render(); toast("Reset."); },
  demo() { S.demoOpen = !S.demoOpen; render(); },
  view(call, i) { S.drawer = { call, i }; log(S.pid, ROLES[S.role].name, "read", `Viewed source in ${CALLS[call].source} ${CALLS[call].title.toLowerCase()} at ${CALLS[call].lines[i].t}`); render(); setTimeout(() => { const el = document.querySelector(".tline.hl"); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); }, 30); },
  closeDrawer() { S.drawer = null; render(); },
  setStatus(id, st) { const r = run(S.pid); const u = r.useCases.find(x => x.id === id); u.status = u.status === st ? "draft" : st; log(S.pid, ROLES[S.role].name, "approval", `${st === "accepted" ? "Accepted" : "Rejected"} use case: ${u.title}`); render(); },
  editCrit(id, el) {
    const r = run(S.pid); const u = r.useCases.find(x => x.id === id); const v = el.value.trim();
    const before = u.criterion ? u.criterion.text : "";
    if (v === before) return;
    u.criterion = { text: v, cite: u.criterion ? u.criterion.cite : null, editedBy: ROLES[S.role].name };
    u.edited = true; log(S.pid, ROLES[S.role].name, "edit", `Edited success criterion for "${u.title}": "${v}"`);
    const g = r.gaps.find(x => x.id === "gap-" + id); if (g && v) { r.gaps = r.gaps.filter(x => x !== g); toast("Gap closed: success criterion added."); }
    render();
  },
  answer(id, el) { const r = run(S.pid); const g = r.gaps.find(x => x.id === id); if (g.answer === el.value) return; g.answer = el.value; log(S.pid, ROLES[S.role].name, "edit", `Answered gap: ${g.text.slice(0, 60)}... -> "${el.value}"`); },
  redraft(id) {
    const r = run(S.pid); const d = r.dummy[id]; const p = pilot(S.pid);
    log(S.pid, ROLES[S.role].name, "draft", "Asked Pia to redraft blocked dummy data");
    d.docs = d.redraft || d.docs; const hits = d.docs.flatMap(doc => dealFactScreen(doc.title + " " + doc.body, p));
    d.hits = hits; d.status = hits.length ? "blocked" : "draft";
    log(S.pid, "Pia (service account, deal team only)", "draft", "Redrafted dummy data with invented names");
    log(S.pid, "PilotHQ checks (code)", "check", hits.length ? "Deal-fact screen blocked the redraft again" : "Deal-fact screen passed on the redraft");
    toast(hits.length ? "Still blocked." : "Redraft passed the deal-fact screen.", hits.length ? "bad" : "good"); render();
  },
  editDoc(id, k, el) { const r = run(S.pid); const d = r.dummy[id]; const t = el.innerText.trim(); if (t === d.docs[k].body) return; const p = pilot(S.pid); d.docs[k].body = t; d.edited = true; const hits = dealFactScreen(t, p); d.hits = hits; d.status = hits.length ? "blocked" : "draft"; log(S.pid, ROLES[S.role].name, "edit", "Edited dummy document: " + d.docs[k].title); if (hits.length) log(S.pid, "PilotHQ checks (code)", "check", "Deal-fact screen blocked the edit: " + hits.map(h => h.term).join(", ")); render(); },
  slot(i) { S.selectedSlot[S.pid] = i; render(); },
  copyInvite() { const t = document.getElementById("invite").innerText; try { navigator.clipboard.writeText(t); } catch (e) {} log(S.pid, ROLES[S.role].name, "send", "Copied the drafted invite to send from their own calendar"); toast("Invite copied. Send it from your own calendar."); render(); },
  note(el) { const v = el.value.trim(); if (!v) return; S.notes[S.pid] = (S.notes[S.pid] || []).concat({ by: ROLES[S.role].name, text: v }); log(S.pid, ROLES[S.role].name, "edit", "Added context for Pia: " + v); el.value = ""; toast("Saved. Pia reads this on the next run."); render(); },
  approve() { S.modal = "approve"; render(); },
  closeModal() { S.modal = null; render(); },
  confirmApprove() {
    const p = pilot(S.pid); const r = run(S.pid);
    const lvl = editLevel(r);
    log(S.pid, ROLES[S.role].name, "approval", `Approved the plan (${lvl.toLowerCase()})`);
    r.useCases.forEach(u => { if (u.status === "draft") u.status = "accepted"; });
    const writes = approvalWrites(p, r);
    S.approved[S.pid] = { by: ROLES[S.role].name, level: lvl, writes, at: stamp() };
    p.stage = "Pilot: approved";
    for (const w of writes) log(S.pid, "PilotHQ (after approval)", "write", `${w.target}: ${w.what}`);
    S.modal = "approved"; render();
  },
  priority(pid, el) { S.priority[pid] = el.value; log(pid, ROLES[S.role].name, "edit", "Priority set to " + el.value); toast("Priority updated."); },
  runChecks() { S.acResults = runAcceptanceChecks(); render(); },
  runTests() {
    S.testRun = { n: 0 }; render();
    const t = setInterval(() => { S.testRun.n++; if (S.testRun.n >= TEST_SET.length) { clearInterval(t); S.testRun.done = true; } render(); }, 90);
  }
};

function startRun(pid, opts) {
  const p = pilot(pid);
  const prev = run(pid);
  let r = runPia(p, { trigger: opts.trigger, modelDown: S.modelDown });
  if (opts.merge && prev && prev.status === "ready" && r.status === "ready") r = mergeRun(clone(prev), r);
  r.version = (S.runs[pid] || []).length + 1;
  r.startedAt = stamp();
  S.runs[pid] = (S.runs[pid] || []).concat(r);
  S.anim = { pid, shown: 0 };
  if (S.view === "pilot" && S.pid === pid && S.role === "le") S.tab = "usecases";
  render();
  const t = setInterval(() => {
    const st = r.steps[S.anim.shown];
    const a = stepAudit(pid, st); log(pid, a.actor, a.type, a.text);
    S.anim.shown++;
    if (S.anim.shown >= r.steps.length) { clearInterval(t); S.anim = null; if (r.status === "ready") toast(r.changes && r.changes.length ? `Pia updated the draft: ${r.changes.length} changes since the last version.` : "Pia's draft is ready for review.", "good"); if (r.status === "failed") toast("Run failed cleanly. Nothing was written.", "bad"); }
    render();
  }, 520);
}

// ---------- rendering ----------
function render() {
  document.getElementById("app").innerHTML = header() + `<main>${main()}</main>` + drawer() + modal() + demoPanel() + toasts();
}

function header() {
  const r = ROLES[S.role];
  return `<header>
    <div class="brand" onclick="A.home()"><span class="logo">P</span><b>PilotHQ</b><span class="muted small">with Pia</span></div>
    <div class="hdr-right">
      <label class="small muted">Viewing as</label>
      <select onchange="A.role(this.value)">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === S.role ? "selected" : ""}>${esc(v.name)} · ${esc(v.label)}</option>`).join("")}</select>
    </div></header>`;
}

function main() {
  if (S.view === "denied") return denied();
  if (S.view === "pilot") return pilotPage();
  if (S.role === "growth") return growthHome();
  if (S.role === "aie") return aieHome();
  return myPilots();
}

function nextAction(p) {
  if (p.static) return p.next;
  const r = run(p.id);
  if (S.anim && S.anim.pid === p.id) return "Pia is drafting";
  if (!r) return "Waiting for the deal to reach pilot stage in Salesforce";
  if (r.status === "nothing") return "No recorded calls. Book a discovery call first.";
  if (r.status === "failed") return "Run failed. Retry when the model is back.";
  if (S.approved[p.id]) return "Plan approved. Send the first training invite.";
  const blocked = Object.values(r.dummy).filter(d => d.status === "blocked").length;
  return S.role === "ae" ? "Waiting for Legal Engineer approval. " + r.gaps.length + " gaps to chase." : `Review Pia's draft: ${r.useCases.length} use case${r.useCases.length === 1 ? "" : "s"}, ${r.gaps.length} question${r.gaps.length === 1 ? "" : "s"}${blocked ? `, ${blocked} blocked draft` : ""}`;
}
function statusChip(p) {
  if (p.static) return `<span class="chip">Running</span>`;
  const r = run(p.id);
  if (S.anim && S.anim.pid === p.id) return `<span class="chip blue"><span class="spin"></span>Pia is working</span>`;
  if (S.approved[p.id]) return `<span class="chip green">Approved</span>`;
  if (!r) return `<span class="chip">Not started</span>`;
  if (r.status === "nothing") return `<span class="chip warn">Nothing to read</span>`;
  if (r.status === "failed") return `<span class="chip red">Run failed</span>`;
  return `<span class="chip blue">Draft ready</span>`;
}

function myPilots() {
  const r = ROLES[S.role];
  const mine = S.pilots.filter(p => canView(S.role, p));
  const title = S.role === "ae" ? "My deals in pilot" : "My pilots";
  return `<div class="page-head"><div><h1>${title}</h1><p class="muted">${esc(r.name)}, ${esc(r.title)}. You see only pilots you are staffed on.</p></div></div>
  <div class="cards">${mine.map(p => `<div class="card pcard" onclick="A.open('${p.id}')">
     <div class="row between"><b>${esc(p.firm)}</b>${statusChip(p)}</div>
     <div class="muted small">${esc(p.region)} · ${p.users} users · ${p.days} days · ${esc(p.stage)}</div>
     <div class="next">${esc(nextAction(p))}</div>
     <div class="row between small muted"><span>AE ${esc(p.ae)} · LE ${esc(p.les.join(", "))}</span><span class="link">Open →</span></div>
   </div>`).join("")}</div>
  ${S.role === "out" ? `<div class="card soft"><b>Someone shared a link in Slack</b><p class="muted small">Try opening a pilot you are not staffed on.</p><button class="btn" onclick="A.open('hv')">Open Harrow & Vale LLP</button></div>` : ""}`;
}

function denied() {
  const p = pilot(S.pid);
  return `<div class="card empty"><h2>You don't have access to this pilot</h2><p class="muted">${esc(ROLES[S.role].name)} is not on the deal team for this pilot, so PilotHQ shows nothing about it. Pia's service account only reads the deal team's records. This attempt is in the activity log.</p><button class="btn" onclick="A.home()">Back to my pilots</button></div>`;
}

// ----- Growth -----
function growthRow(p) {
  let criteria = p.criteria, risk = p.risk, riskWhy = p.riskWhy || "";
  if (!p.static) {
    const r = run(p.id);
    if (S.approved[p.id]) { const k = r.useCases.filter(u => u.status !== "rejected"); criteria = `${k.filter(u => u.criterion && u.criterion.text).length} of ${k.length} agreed`; }
    else if (r && r.status === "ready") criteria = `${r.useCases.filter(u => u.criterion).length} drafted, not agreed`;
    else criteria = "None yet";
    const short = p.leNeed - p.leStaffed;
    risk = r && r.status === "nothing" ? "Medium" : short > 0 ? "Medium" : "Low";
    riskWhy = r && r.status === "nothing" ? "No recorded calls yet" : short > 0 ? `Short of ${short} Legal Engineer hours this week` : "";
  }
  const pct = Math.min(100, Math.round(p.leStaffed / p.leNeed * 100));
  return `<tr>
    <td><b>${esc(p.firm)}</b><div class="muted small">${esc(p.region)} · ${p.users} users</div></td>
    <td>${esc(p.stage)}${p.day ? `<div class="muted small">${p.day}</div>` : ""}</td>
    <td>${esc(nextAction(p))}</td>
    <td>${esc(criteria)}</td>
    <td><div class="cap"><div class="capbar"><span style="width:${pct}%" class="${pct < 100 ? "short" : ""}"></span></div><span class="small">${p.leStaffed} of ${p.leNeed} h staffed</span></div></td>
    <td><span class="chip ${risk === "High" ? "red" : risk === "Medium" ? "warn" : "green"}">${risk}</span><div class="muted small">${esc(riskWhy)}</div></td>
    <td><select onchange="A.priority('${p.id}',this)">${["Normal", "High", "Low"].map(o => `<option ${S.priority[p.id] === o ? "selected" : ""}>${o}</option>`).join("")}</select></td>
    <td><span class="link" onclick="A.open('${p.id}')">Open</span></td></tr>`;
}
function growthHome() {
  const short = S.pilots.reduce((a, p) => a + Math.max(0, p.leNeed - p.leStaffed), 0);
  return `<div class="page-head"><div><h1>All pilots</h1><p class="muted">Stage, risk and next step for every pilot. Legal Engineer capacity is shown per pilot, not per person.</p></div></div>
  <div class="tiles">
    <div class="tile"><span class="muted small">Pilots</span><b>${S.pilots.length}</b></div>
    <div class="tile"><span class="muted small">Waiting for approval</span><b>${S.pilots.filter(p => !p.static && run(p.id) && run(p.id).status === "ready" && !S.approved[p.id]).length}</b></div>
    <div class="tile"><span class="muted small">Legal Engineer hours short this week</span><b>${short} h</b></div>
    <div class="tile"><span class="muted small">High risk</span><b>${S.pilots.filter(p => p.risk === "High").length}</b></div>
  </div>
  <div class="card flush"><table class="grid"><thead><tr><th>Pilot</th><th>Stage</th><th>Next step</th><th>Success criteria</th><th>Legal Engineer capacity</th><th>Risk</th><th>Priority</th><th></th></tr></thead>
  <tbody>${S.pilots.map(growthRow).join("")}</tbody></table></div>
  <p class="muted small">Growth leadership can reprioritise pilots but cannot edit plans or drafts.</p>`;
}

// ----- AI Enablement -----
function aieHome() {
  const tabs = [["checks", "Acceptance checks"], ["tests", "Test set"], ["runs", "Run log"], ["audit", "Activity log"]];
  return `<div class="page-head"><div><h1>AI Enablement</h1><p class="muted">Run log, test results and checks. You maintain prompts, rules and the test set; you can't approve pilot plans or read pilot content.</p></div></div>
  <div class="tabs">${tabs.map(([k, l]) => `<button class="${S.aieTab === k ? "on" : ""}" onclick="A.aieTab('${k}')">${l}</button>`).join("")}</div>
  ${S.aieTab === "checks" ? acView() : S.aieTab === "tests" ? testView() : S.aieTab === "runs" ? runLog() : auditTable(S.audit)}`;
}

function acView() {
  const res = S.acResults;
  const passed = res ? res.filter(r => r.pass).length : 0;
  return `<div class="row between"><p class="muted">Each acceptance criterion, run against the current version of Pia.</p><button class="btn primary" onclick="A.runChecks()">Run all 12 checks</button></div>
  ${res ? `<div class="banner ${passed === res.length ? "good" : "bad"}">${passed} of ${res.length} acceptance criteria pass</div>` : ""}
  <div class="card flush"><table class="grid"><thead><tr><th>#</th><th>Given</th><th>When</th><th>Then</th><th>Result</th></tr></thead><tbody>
  ${AC_DEFS.map((d, i) => { const r = res && res[i]; return `<tr><td><b>${d.id}</b></td><td>${esc(d.given)}</td><td>${esc(d.when)}</td><td>${esc(d.then)}</td><td>${r ? `<span class="chip ${r.pass ? "green" : "red"}">${r.pass ? "Pass" : "Fail"}</span><div class="muted small">${esc(r.evidence)}</div>` : `<span class="muted small">Not run</span>`}</td></tr>`; }).join("")}
  </tbody></table></div>`;
}

function testView() {
  const t = S.testRun; const n = t ? t.n : 0;
  const rows = TEST_SET.slice(0, n);
  const lab = rows.reduce((a, r) => a + r[2], 0), found = rows.reduce((a, r) => a + r[3], 0), inv = rows.reduce((a, r) => a + r[4], 0);
  const pct = lab ? Math.round(found / lab * 100) : 0;
  const done = t && t.done;
  return `<div class="row between"><p class="muted">24 past pilots, labelled by Legal Engineers with the use cases they would have chosen. Pass mark: at least 80% found and none invented. Runs on every change to a prompt, a step or the model; a failure blocks release.</p><button class="btn primary" onclick="A.runTests()">Run test set</button></div>
  <div class="tiles">
    <div class="tile"><span class="muted small">Labelled use cases found</span><b>${t ? pct + "%" : "–"}</b><span class="small muted">${t ? `${found} of ${lab}` : "target 80%"}</span></div>
    <div class="tile"><span class="muted small">Invented use cases</span><b>${t ? inv : "–"}</b><span class="small muted">target 0</span></div>
    <div class="tile"><span class="muted small">Deal facts in dummy data</span><b>${t ? 0 : "–"}</b><span class="small muted">target 0</span></div>
    <div class="tile"><span class="muted small">Release gate</span><b>${done ? (pct >= 80 && inv === 0 ? `<span class="okc">Pass</span>` : `<span class="badc">Blocked</span>`) : t ? "Running" : "–"}</b></div>
  </div>
  <div class="card flush"><table class="grid"><thead><tr><th>Past pilot</th><th>Firm and practice (de-identified)</th><th>Labelled</th><th>Found</th><th>Invented</th><th></th></tr></thead><tbody>
  ${rows.map(r => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td><span class="chip ${r[3] / r[2] >= 0.8 ? "green" : "warn"}">${Math.round(r[3] / r[2] * 100)}%</span></td></tr>`).join("") || `<tr><td colspan="6" class="muted">Not run yet.</td></tr>`}
  </tbody></table></div>`;
}

function runLog() {
  const all = [];
  for (const [pid, rs] of Object.entries(S.runs)) rs.forEach(r => all.push({ pid, r }));
  return `<div class="card flush"><table class="grid"><thead><tr><th>Run</th><th>Pilot</th><th>Trigger</th><th>Status</th><th>Sources read</th><th>Use cases kept / removed</th><th>Blocked drafts</th><th>Cost</th></tr></thead><tbody>
  ${all.map(({ pid, r }) => `<tr><td>v${r.version}</td><td>${esc(pilot(pid).firm)}</td><td class="small">${esc(r.steps[0].detail)}</td><td><span class="chip ${r.status === "ready" ? "green" : r.status === "failed" ? "red" : "warn"}">${r.status}</span></td><td>${r.read.length ? r.read.map(c => CALLS[c].source).join(", ") + " + Salesforce, Notion" : "none"}</td><td>${r.useCases.length} / ${r.removed.length}</td><td>${Object.values(r.dummy).filter(d => d.hits && d.hits.length).length}</td><td>${r.status === "ready" ? "$" + (0.9 + 0.25 * r.read.length).toFixed(2) : r.status === "failed" ? "$0.02" : "$0.00"}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">No runs yet.</td></tr>`}
  </tbody></table></div>`;
}

function auditTable(rows) {
  const icon = { start: "▶", read: "📖", draft: "✎", check: "✓", approval: "👤", edit: "✎", write: "⤓", send: "✉", access: "⛔" };
  return `<div class="card flush"><table class="grid audit"><thead><tr><th>Time (London)</th>${S.view === "pilot" ? "" : "<th>Pilot</th>"}<th>Who</th><th>Type</th><th>What</th></tr></thead><tbody>
  ${rows.slice().reverse().map(e => `<tr><td class="mono">${e.at}</td>${S.view === "pilot" ? "" : `<td>${esc(pilot(e.pid) ? pilot(e.pid).firm : "")}</td>`}<td>${esc(e.actor)}</td><td><span class="chip">${icon[e.type] || ""} ${e.type}</span></td><td>${esc(e.text)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Nothing logged yet.</td></tr>`}
  </tbody></table></div>`;
}

// ----- Pilot page -----
function pilotPage() {
  const p = pilot(S.pid); const r = run(p.id); const anim = S.anim && S.anim.pid === p.id;
  if (p.static) return staticPilot(p);
  const blocked = r ? Object.values(r.dummy).filter(d => d.status === "blocked").length : 0;
  let action = "";
  if (S.approved[p.id]) action = `<span class="chip green big">✓ Approved by ${esc(S.approved[p.id].by)}</span>`;
  else if (S.role === "le" && r && r.status === "ready" && !anim) action = `<button class="btn primary big" ${blocked ? "disabled" : ""} onclick="A.approve()">Approve plan</button>${blocked ? `<div class="small badc">Resolve ${blocked} blocked dummy data draft first</div>` : ""}`;
  else if (S.role === "ae" && r && r.status === "ready") action = `<span class="muted small">Only the Legal Engineer can approve the plan</span>`;
  else if (S.role === "growth") action = `<span class="muted small">Read only</span>`;

  const tabs = S.role === "le" ? [["usecases", "Use cases"], ["gaps", "Gaps"], ["dummy", "Dummy data"], ["schedule", "Scheduling"], ["activity", "Activity"]]
    : S.role === "ae" ? [["plan", "Plan"], ["usecases", "Use cases"], ["schedule", "Scheduling"], ["activity", "Activity"]]
    : [["plan", "Plan"], ["usecases", "Use cases"], ["activity", "Activity"]];
  if (!tabs.some(t => t[0] === S.tab)) S.tab = tabs[0][0];
  const count = k => !r || r.status !== "ready" ? "" : k === "usecases" ? r.useCases.length : k === "gaps" ? r.gaps.length : k === "dummy" ? Object.keys(r.dummy).length : "";

  return `<div class="crumbs"><span class="link" onclick="A.home()">← ${S.role === "growth" ? "All pilots" : "My pilots"}</span></div>
  <div class="page-head">
    <div><h1>${esc(p.firm)}</h1>
      <div class="row wrap small muted"><span class="chip">${esc(p.stage)}</span><span>${esc(p.region)}</span>·<span>${p.users} users</span>·<span>${p.days} days</span>·<span>AE ${esc(p.ae)}</span>·<span>LE ${esc(p.les.join(", "))}</span>·<span>Salesforce: ${esc(p.salesforce.opportunity)}</span></div></div>
    <div class="actions">${action}</div></div>
  ${r && r.changes && r.changes.length && !anim ? `<div class="banner info"><b>Updated after the follow-up call (Gong, 18 Nov).</b> Your edits were kept. ${r.changes.map(esc).join(" · ")}</div>` : ""}
  ${S.approved[p.id] ? `<div class="banner good">Plan approved. Written to Notion and Slack; a de-identified copy went to the library. Nothing was sent to the firm.</div>` : ""}
  <div class="split">
    <aside>${runPanel(p, r, anim)}</aside>
    <section>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="${S.tab === k ? "on" : ""}" onclick="A.tab('${k}')">${l}${count(k) !== "" ? ` <span class="count">${count(k)}</span>` : ""}</button>`).join("")}</div>
      ${tabBody(p, r, anim)}
    </section>
  </div>`;
}

function staticPilot(p) {
  return `<div class="crumbs"><span class="link" onclick="A.home()">← Back</span></div><div class="page-head"><div><h1>${esc(p.firm)}</h1><div class="small muted">${esc(p.stage)} · ${p.day} · ${esc(p.region)}</div></div></div>
  <div class="card"><p>This pilot was set up before Pia. Next step: <b>${esc(p.next)}</b>. Success criteria: ${esc(p.criteria)}.</p></div>`;
}

function runPanel(p, r, anim) {
  if (!r) return `<div class="card"><h3>Pia's run</h3><p class="muted">No run yet. Pia starts on its own when the deal reaches pilot stage in Salesforce, and re-runs if a new call lands before approval.</p></div>`;
  const shown = anim ? S.anim.shown : r.steps.length;
  const tag = { fixed: ["Fixed", ""], ai: ["Pia", "blue"], person: ["Person", "green"] };
  const icon = { ok: "✓", warn: "!", blocked: "✕", error: "✕", stop: "■", wait: "…", skip: "–" };
  const versions = S.runs[p.id].length;
  return `<div class="card run"><div class="row between"><h3>Pia's run</h3><span class="small muted">Version ${r.version}${versions > 1 ? ` of ${versions}` : ""}</span></div>
    <div class="legend small muted"><span class="chip">Fixed</span> code that always runs <span class="chip blue">Pia</span> agent decides <span class="chip green">Person</span></div>
    <ol class="steps">${r.steps.map((st, i) => {
      const state = i < shown ? st.status : i === shown && anim ? "running" : "pending";
      return `<li class="st ${state}"><span class="dot">${state === "running" ? `<span class="spin"></span>` : state === "pending" ? "" : icon[st.status]}</span>
        <div><div class="row between"><b>${esc(st.label)}</b><span class="chip ${tag[st.kind][1]}">${tag[st.kind][0]}</span></div>
        ${i < shown ? `<div class="small muted">${esc(st.detail)}</div>${st.tool ? `<div class="tool small">${esc(st.tool)}</div>` : ""}` : ""}</div></li>`;
    }).join("")}</ol>
    ${r.status === "failed" && !anim && S.role === "le" ? `<button class="btn" onclick="A.retry('${p.id}')">Retry run</button>` : ""}
  </div>`;
}

function tabBody(p, r, anim) {
  if (S.tab === "activity") return auditTable(S.audit.filter(e => e.pid === p.id));
  if (anim) return `<div class="card empty"><span class="spin big"></span><p class="muted">Pia is reading and drafting. Nothing is shown until the source check and deal-fact screen have run.</p></div>`;
  if (!r) return `<div class="card empty"><p class="muted">Nothing drafted yet.</p></div>`;
  if (r.status === "nothing") return `<div class="card empty"><h3>Nothing to read</h3><p class="muted">This pilot has no recorded calls Pia is allowed to read, so Pia drafted nothing rather than guessing. Book a discovery call and record it in Gong or Granola.</p></div>`;
  if (r.status === "failed") return `<div class="card empty"><h3>The run stopped</h3><p class="muted">The model did not respond. The run stopped cleanly: nothing was half-written to Notion or Slack. ${S.role === "le" ? "Retry from the run panel." : "The Legal Engineer has been told to retry."}</p></div>`;
  if (S.tab === "plan") return planTab(p, r);
  if (S.tab === "usecases") return useCasesTab(p, r);
  if (S.tab === "gaps") return gapsTab(p, r);
  if (S.tab === "dummy") return dummyTab(p, r);
  if (S.tab === "schedule") return scheduleTab(p, r);
  return "";
}

function srcLink(cite, label = "Source") {
  if (!cite) return "";
  const l = lineAt(cite); const c = CALLS[cite.call];
  const i = l.text.toLowerCase().indexOf(cite.quote.toLowerCase());
  const html = i < 0 ? esc(l.text) : esc(l.text.slice(0, i)) + "<mark>" + esc(l.text.slice(i, i + cite.quote.length)) + "</mark>" + esc(l.text.slice(i + cite.quote.length));
  return `<span class="src">${label === "icon" ? "❝" : `❝ ${label}`}<span class="hovercard"><span class="small muted">${c.source} · ${esc(c.title)} · ${c.date} · ${l.t}</span><span class="quote">“${html}”</span><span class="small muted">${esc(l.who)}</span><button class="btn small" onclick="A.view('${cite.call}',${cite.i})">View in call</button></span></span>`;
}

function useCasesTab(p, r) {
  const editable = S.role === "le" && !S.approved[p.id];
  const st = { draft: ["Draft", "warn"], accepted: ["Accepted", "green"], rejected: ["Rejected", "red"] };
  return `<p class="muted small">AI output stays a draft until a Legal Engineer approves. Hover ❝ to see the sentence each item came from.</p>
  <div class="card flush"><table class="grid uc"><thead><tr><th>Use case</th><th>Practice area</th><th>Success criterion</th><th>Past pilot match</th><th>Status</th></tr></thead><tbody>
  ${r.useCases.map(u => `<tr class="${u.status}">
    <td><div class="uct">${esc(u.title)} ${srcLink(u.cite, "icon")}</div><div class="small muted">Legora feature: ${esc(u.feature)} ${u.change === "new" ? `<span class="chip blue">New</span>` : u.change === "changed" ? `<span class="chip blue">Changed</span>` : u.change === "kept" ? `<span class="chip">Your edits kept</span>` : ""}</div></td>
    <td>${esc(u.practice)}</td>
    <td>${editable ? `<textarea rows="2" placeholder="No criterion in the calls. Add one or ask the firm." onchange="A.editCrit('${u.id}',this)">${esc(u.criterion ? u.criterion.text : "")}</textarea>` : `<div>${u.criterion && u.criterion.text ? esc(u.criterion.text) : `<span class="badc">Not in the calls</span>`}</div>`}
      <div class="small muted">${u.criterion && u.criterion.cite ? srcLink(u.criterion.cite) : ""} ${u.edited ? "Edited by you" : ""} ${u.change === "changed" ? `Was: ${esc(u.was)}` : ""}</div></td>
    <td>${u.library ? `<div class="lib"><b>${u.library.id}</b> <span class="chip ${u.library.score >= 80 ? "green" : ""}">${u.library.score >= 80 ? "Strong" : "Partial"}</span><div class="small muted">${esc(u.library.entry.summary)}</div><div class="small">Configured: ${esc(u.library.entry.configured)}</div></div>` : `<span class="muted small">No match</span>`}</td>
    <td><span class="chip ${st[u.status][1]}">${st[u.status][0]}</span>${editable ? `<div class="row small-gap"><button class="icon ok" title="Accept" onclick="A.setStatus('${u.id}','accepted')">✓</button><button class="icon no" title="Reject" onclick="A.setStatus('${u.id}','rejected')">✕</button></div>` : ""}</td>
  </tr>`).join("")}
  </tbody></table></div>
  ${r.removed.length ? `<details class="card soft"><summary><b>${r.removed.length} removed by the source check</b> <span class="muted small">before anyone saw them</span></summary>${r.removed.map(x => `<p class="small"><s>${esc(x.title)}</s> · ${esc(x.why)}</p>`).join("")}</details>` : ""}
  ${r.skipped && r.skipped.length ? `<div class="banner warn small">Skipped ${r.skipped.length} call because the firm has not agreed to AI processing: ${r.skipped.map(c => `${CALLS[c].source}, ${CALLS[c].title}, ${CALLS[c].date}`).join("; ")}.</div>` : ""}`;
}

function gapsTab(p, r) {
  const editable = S.role === "le" && !S.approved[p.id];
  if (!r.gaps.length) return `<div class="card empty"><p class="muted">No open questions.</p></div>`;
  return `<p class="muted small">Where the calls don't say, Pia asks instead of guessing. Answer here, or leave it for the Account Executive to chase with the firm.</p>
  ${r.gaps.map(g => `<div class="card gap"><div class="row between"><span class="chip warn">${esc(g.kind)}</span>${srcLink(g.cite)}</div><p>${esc(g.text)}</p>
   ${editable ? `<textarea rows="2" placeholder="Your answer, or leave for the Account Executive" onchange="A.answer('${g.id}',this)">${esc(g.answer)}</textarea>` : g.answer ? `<p class="small"><b>Answer:</b> ${esc(g.answer)}</p>` : ""}</div>`).join("")}`;
}

function dummyTab(p, r) {
  const editable = S.role === "le" && !S.approved[p.id];
  return `<p class="muted small">First drafts, all invented. Every draft runs through the deal-fact screen (names from Salesforce plus a model check) before you see it.</p>
  ${r.useCases.filter(u => r.dummy[u.id]).map(u => { const d = r.dummy[u.id]; return `<div class="card dd ${d.status}">
    <div class="row between"><b>${esc(u.title)}</b><span class="chip ${d.status === "blocked" ? "red" : "warn"}">${d.status === "blocked" ? "Blocked" : "Draft · invented"}</span></div>
    <p class="small">${esc(d.brief)}</p>
    ${d.status === "blocked" ? `<div class="banner bad small"><b>Blocked by the deal-fact screen.</b> ${d.hits.map(h => `"${esc(h.term)}" is a ${esc(h.kind)} (found by ${h.by}, from Salesforce)`).join("; ")}. The draft is hidden so it can't be copied into the pilot.</div>
      <div class="doc blur">${esc(d.docs[0].body)}</div>${editable ? `<button class="btn" onclick="A.redraft('${u.id}')">Ask Pia to redraft with invented names</button>` : ""}`
    : d.docs.map((doc, k) => `<div class="doc"><div class="doctitle">${esc(doc.title)} <span class="chip">Invented</span></div><div class="docbody" ${editable ? `contenteditable="true" onblur="A.editDoc('${u.id}',${k},this)"` : ""}>${esc(doc.body)}</div></div>`).join("")}
  </div>`; }).join("")}
  <p class="muted small">Legal-realism review: a Legal Engineer checks a sample of dummy documents against the spec before the pilot.</p>`;
}

function scheduleTab(p, r) {
  const cal = p.calendar; if (!cal || !r.slots.length) return `<div class="card empty"><p class="muted">No slots proposed.</p></div>`;
  const sel = S.selectedSlot[p.id] ?? 0; const s = r.slots[sel];
  const people = [...cal.internal, ...cal.firm];
  const fmt = sl => `${sl.day} ${sl.date}`;
  const invite = `To: Priya Raman, Wei Ling Ho (Harrow & Vale); Tom Achebe, Mei Tan (Legora)
Subject: Legora pilot: first training session for banking associates
When: ${fmt(s)}, ${s.local.find(x => x.city === "London").time} London / ${s.local.find(x => x.city === "Singapore").time} Singapore (60 min)

Hi Priya and Wei Ling,

As agreed, we'd like to start the pilot with the banking associates in London and Singapore. This first session covers facility agreement review in Tabular Review, using invented agreements only.

Does this time work for you? Happy to move it.

Sofia`;
  return `<div class="card"><div class="row between"><b>${esc(cal.session)}</b>${srcLink(cal.sessionCite)}</div>
    <p class="small muted">Pia read free/busy for the Legora team from Google Calendar. Firm calendars are not read; only their working hours (08:00 to 18:00 local).</p>
    <table class="grid slots"><thead><tr><th></th><th>Slot</th>${people.map(x => `<th>${esc(x.name.split(" ")[0])}<div class="small muted">${x.city}</div></th>`).join("")}</tr></thead><tbody>
    ${r.slots.map((sl, i) => `<tr class="${i === sel ? "sel" : ""}" onclick="A.slot(${i})"><td><input type="radio" ${i === sel ? "checked" : ""}></td><td><b>${fmt(sl)}</b></td>${sl.local.map(x => `<td>${x.time}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
  <div class="card"><div class="row between"><b>Drafted invite</b><span class="chip warn">Draft</span></div>
    <pre id="invite" class="invite">${esc(invite)}</pre>
    ${S.role === "ae" ? `<button class="btn primary" onclick="A.copyInvite()">Copy invite to send from my calendar</button>` : `<button class="btn" onclick="A.copyInvite()">Copy invite</button>`}</div>`;
}

function planTab(p, r) {
  const ok = S.approved[p.id];
  const kept = r.useCases.filter(u => u.status !== "rejected");
  const sel = S.selectedSlot[p.id] ?? 0; const s = r.slots[sel];
  return `<div class="two">
   <div class="card"><h3>What's agreed</h3>${ok ? "" : `<p class="small badc">Draft. Waiting for ${esc(p.les[0])} to approve.</p>`}
     <ul class="plain">${kept.map(u => `<li><b>${esc(u.practice)}:</b> ${esc(u.title)}<div class="small muted">Success: ${u.criterion && u.criterion.text ? esc(u.criterion.text) : "not agreed yet"}</div></li>`).join("")}</ul></div>
   <div class="card"><h3>What's next</h3><ul class="plain">
     <li>${ok ? "✓" : "○"} Legal Engineer approves the plan</li>
     <li>○ Chase ${r.gaps.length} open questions with the firm</li>
     ${s ? `<li>○ Send the first training invite (${s.day} ${s.date}, proposed)</li>` : ""}
     <li>○ Kickoff, then first rollout training</li></ul>
     <p class="small muted">Decision needed by the firm: end of January (${srcLink({ call: "g1", i: 10, quote: "decision by the end of January" })}).</p></div>
   <div class="card"><h3>Gaps to chase <span class="count">${r.gaps.length}</span></h3>${r.gaps.map(g => `<p class="small">• ${esc(g.text)} ${srcLink(g.cite, "icon")}${g.answer ? `<br><span class="muted">Answer: ${esc(g.answer)}</span>` : ""}</p>`).join("") || `<p class="muted small">None.</p>`}</div>
   ${S.role === "ae" ? `<div class="card"><h3>Add context for Pia</h3><textarea rows="3" placeholder="e.g. The firm's champion is moving to the Singapore office in December."></textarea><button class="btn" onclick="A.note(this.previousElementSibling)">Save</button>
     ${(S.notes[p.id] || []).map(n => `<p class="small">• ${esc(n.text)} <span class="muted">(${esc(n.by)})</span></p>`).join("")}</div>` : ""}
  </div>`;
}

function drawer() {
  if (!S.drawer) return "";
  const c = CALLS[S.drawer.call];
  return `<div class="drawer"><div class="row between"><div><span class="chip">${c.source}</span> <b>${esc(c.title)}</b><div class="small muted">${c.date} · ${c.length} · ${c.consent ? "Firm agreed to recording and AI processing" : "No AI-processing consent"}</div></div><button class="icon" onclick="A.closeDrawer()">✕</button></div>
   <div class="small muted people">${c.people.map(esc).join("<br>")}</div>
   <div class="transcript">${c.lines.map((l, i) => `<div class="tline ${i === S.drawer.i ? "hl" : ""}"><span class="mono small muted">${l.t}</span><div><b class="small">${esc(l.who)}</b><div>${esc(l.text)}</div></div></div>`).join("")}</div>
   <p class="small muted">Transcript text is treated as data, never as instructions to Pia.</p></div>`;
}

function modal() {
  if (!S.modal) return "";
  const p = pilot(S.pid); const r = run(S.pid);
  if (S.modal === "approve") {
    const kept = r.useCases.filter(u => u.status !== "rejected"); const rej = r.useCases.length - kept.length;
    return `<div class="scrim"><div class="modal"><h2>Approve the pilot plan</h2>
      <p>${kept.length} use cases${rej ? `, ${rej} rejected` : ""}. ${r.gaps.length} open questions go into the plan for the Account Executive to chase.</p>
      <p class="small">Your edits: <b>${editLevel(r)}</b> <span class="muted">(quality guard: target 80% of drafts approved with light or no edits)</span></p>
      <h3>What will be written</h3><ul class="plain">${approvalWrites(p, r).map(w => `<li><span class="chip">${w.target}</span> ${esc(w.what)}</li>`).join("")}</ul>
      <p class="small muted">Nothing goes to the firm. The Account Executive sends the invite.</p>
      <div class="row end"><button class="btn" onclick="A.closeModal()">Cancel</button><button class="btn primary" onclick="A.confirmApprove()">Approve plan</button></div></div></div>`;
  }
  const ap = S.approved[S.pid]; const kept = r.useCases.filter(u => u.status !== "rejected");
  return `<div class="scrim"><div class="modal"><h2>✓ Plan approved</h2>
    ${ap.writes.map(w => `<p class="small"><span class="chip green">Done</span> <b>${w.target}:</b> ${esc(w.what)}</p>`).join("")}
    <div class="slack"><div class="small muted">#pilot-hv-harrow · PilotHQ app</div><p><b>Harrow & Vale pilot plan approved</b> by ${esc(ap.by)}.<br>${kept.length} use cases: ${kept.map(u => esc(u.practice)).join(", ")}.<br>${r.gaps.length} questions to chase with the firm (Sofia).<br>Next: first training for banking associates, invite drafted for Sofia to send.<br><span class="link">Open in PilotHQ</span></p></div>
    <div class="row end"><button class="btn primary" onclick="A.closeModal()">Done</button></div></div></div>`;
}

function demoPanel() {
  const hv = pilot("hv");
  return `<div class="demo ${S.demoOpen ? "" : "closed"}"><div class="row between" onclick="A.demo()" style="cursor:pointer"><b class="small">Simulate events</b><span class="small muted">${S.demoOpen ? "Hide" : "Show"}</span></div>
  ${S.demoOpen ? `<p class="small muted">Trigger what would normally come from Salesforce, Gong or the model. All firms and people are fictional.</p>
    <button class="btn small full" ${hv.stage !== "Proof of value" ? "disabled" : ""} onclick="A.stageChange()">Salesforce: move Harrow & Vale to pilot stage</button>
    <button class="btn small full" ${S.g2Landed ? "disabled" : ""} onclick="A.landCall()">Gong: follow-up call lands</button>
    <label class="small row"><input type="checkbox" ${S.modelDown ? "checked" : ""} onchange="A.toggleModel()"> Model outage</label>
    <button class="btn small full ghost" onclick="A.reset()">Start again</button>` : ""}</div>`;
}

function toasts() { return `<div class="toasts">${S.toasts.map(t => `<div class="toast ${t.kind}">${esc(t.msg)}</div>`).join("")}</div>`; }

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
  const hv = clone(PILOTS.find(p => p.id === "hv"));
  const nh = clone(PILOTS.find(p => p.id === "nh")), bw = clone(PILOTS.find(p => p.id === "bw"));
  const r1 = runPia(hv);
  const checks = [
    () => { const ok = r1.status === "ready" && r1.steps[0].label === "Start" && r1.steps.at(-1).detail.includes(hv.les[0]); return [ok, `One run, ${r1.steps.length} steps, waiting for ${hv.les[0]}`]; },
    () => { const r2 = mergeRun(clone(r1), runPia(hv, { extraCalls: ["g2"] })); const ok = r2.useCases.some(u => u.change === "new") && r2.useCases.some(u => u.change === "changed"); return [ok, r2.changes.join("; ")]; },
    () => { const ok = r1.useCases.length > 0 && r1.useCases.every(u => sourceCheck(u.cite, r1.read).ok && lineAt(u.cite)); return [ok, `${r1.useCases.length} of ${r1.useCases.length} use cases resolve to a sentence in a call`]; },
    () => { const ok = r1.removed.some(x => x.id === "uc-spa") && !r1.useCases.some(u => u.id === "uc-spa"); return [ok, `Removed: ${r1.removed.map(x => x.title + " (" + x.why + ")").join("; ")}`]; },
    () => { const d = r1.dummy["uc-chron"]; const clean = dealFactScreen(d.redraft.map(x => x.title + " " + x.body).join(" "), hv).length === 0; const ok = d.status === "blocked" && d.hits.some(h => h.term === "Meridian Shipping") && clean; return [ok, `Blocked on "${d.hits.map(h => h.term).join(", ")}"; redraft passes`]; },
    () => { const ok = r1.gaps.some(g => g.id === "gap-uc-dd") && r1.gaps.some(g => g.kind === "Practice with no use case"); return [ok, `${r1.gaps.length} questions asked, e.g. "${r1.gaps[0].text.slice(0, 60)}..."`]; },
    () => { const r = runPia(nh); const ok = r.status === "nothing" && r.useCases.length === 0; return [ok, r.steps.at(-1).detail]; },
    () => { const r = runPia(bw); const ok = r.skipped.includes("gb1") && !r.useCases.some(u => u.cite.call === "gb1") && r.steps[1].status === "warn"; return [ok, r.steps[1].detail]; },
    () => { const ok = !canView("out", hv) && canView("le", hv) && !canView("aie", hv); return [ok, "Lars Berg (not on the deal) is refused; Tom Achebe can open it"]; },
    () => { const r = runPia(hv, { modelDown: true }); const ok = r.status === "failed" && r.useCases.length === 0 && !r.steps.some(s => s.label.startsWith("Draft")) && /retry/i.test(r.steps.at(-1).detail); return [ok, "Stopped at planning; no drafts, no writes, retry offered"]; },
    () => { const w = approvalWrites(hv, r1); const ok = w.some(x => x.target === "Notion") && w.some(x => x.target === "Slack") && !("writes" in r1); return [ok, w.map(x => x.target).join(", ") + "; nothing written before approval"]; },
    () => { const ev = r1.steps.map(st => stepAudit("hv", st)); const types = new Set(ev.map(e => e.type)); const ok = ev.length === r1.steps.length && ["read", "draft", "check", "approval"].every(t => types.has(t)); return [ok, `${ev.length} log entries for ${r1.steps.length} steps: ${[...types].join(", ")}`]; }
  ];
  return checks.map(fn => { try { const [pass, evidence] = fn(); return { pass, evidence }; } catch (e) { return { pass: false, evidence: "Error: " + e.message }; } });
}

S = freshState(); seed(); render();
