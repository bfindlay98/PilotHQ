# AGENTS.md: PilotHQ v2 build brief

Instructions for a coding agent working on this repo. Read all of it before changing anything.

## 1. What this is

PilotHQ is an internal app for the Growth team at ABC Inc., a legal AI company that runs pilots with law firms before they buy. It holds one shared record per pilot. **Pia** is the agent inside PilotHQ: it reads discovery calls, the deal, past pilots and calendars, then drafts the pilot plan for a Legal Engineer to approve.

- **The app (PilotHQ)** is where people work: views, records, tasks, approvals, navigation.
- **The agent (Pia)** reads and drafts. Pia runs on every pilot, for every team. Pia never approves, never sends anything to a firm, and nothing it drafts is saved until a Legal Engineer approves.

## 2. Repo, build and deploy

- Plain HTML, CSS and JavaScript. No framework, no build tools, no npm. Keep it that way.
- `data.js`: fictional data (calls, pilots, library, people, tasks, mock model output).
- `engine.js`: Pia's run and the fixed checks (consent check, source check, deal-fact screen, injection flag, slot finder, re-run merge, access rule). **Do not weaken these.**
- `app.js`: the UI. `index.html`: markup shell and CSS.
- `./build.sh` bundles everything into `PilotHQ.html` (a single file that works offline).
- Live site: GitHub Pages from `main`, root folder. `index.html` loads the three scripts directly, so both `index.html` and `PilotHQ.html` must keep working.
- The model is mocked. Pia's drafts come from `MOCK_MODEL` in `data.js`. Do not add API calls or keys.

## 3. Content rules

- All firms, people, deals and documents are fictional. The company is always "ABC Inc.". Never use real company, law firm or product names.
- Plain language. No em dashes. British spelling. No filler words ("seamlessly", "leverage", "unlock").
- No commentary about the build in the UI: no "prototype", "V1", "V3", "tier", "illustrative", "mock", "demo", "appendix".
- Keep the 12 acceptance checks passing (`runAcceptanceChecks` in `app.js`). If you rename roles or move code, update the checks; don't delete them.
- Nothing in the app sends anything to a firm. Invites are drafted; a person sends them.

## 4. Features to support

1. Pia drafts use cases from the calls, each linked to its source sentence.
2. Gaps: practices with no use case and use cases with no success criterion, each as a question.
3. Past-pilot library matches for each use case, with what was configured.
4. Dummy data drafts per use case, screened for deal facts.
5. Legal Engineer approves, edits or rejects every draft.
6. One pilot record with agreed success criteria, next steps and owners.
7. Legal Engineer capacity per pilot, now and for the coming weeks.
8. Every pilot's stage, risk and next step in one list.
9. Activity log of every read, draft, check and approval, plus test results.
10. Slack summary to the pilot channel after approval, and a weekly digest.
11. Proposed meeting slots across time zones, with a drafted invite.

## 5. Roles

| Role | Lands on | Main job |
| --- | --- | --- |
| Legal Engineer | My work | Review and approve Pia's drafts; do assigned tasks |
| Account Executive (pilot coordinator) | My pilots | See how each pilot is tracking, who owns each workstream, chase gaps, send invites |
| Enterprise Sales Manager | Portfolio | All pilots in one view: progress, risk, capacity coming up, reprioritise, assign |
| AI Enablement | Quality | Run log, acceptance checks, test set, connection health |
| Outside the deal team | My work | Sees only their own pilots (access check) |

Rename "Growth leadership" to **Enterprise Sales Manager** everywhere (Dana Whitfield, "Enterprise Sales Manager, EMEA"). Same permissions: sees all pilots, can reprioritise and assign, cannot edit plans or drafts.

## 6. Navigation

**Global top bar**, left to right: PilotHQ wordmark (text only), primary tabs, then search, a notifications bell and the user's avatar (menu with "Switch role").

**Primary tabs** (the set depends on the role):
| Tab | Who | What it shows |
| --- | --- | --- |
| My work | Everyone | Tasks assigned to me (due date, pilot, status), items waiting for me, recent Pia activity on my pilots |
| Approvals | Legal Engineer, Enterprise Sales Manager | Inbox of things waiting for my decision (see 7.3) with a count badge |
| Pilots | Everyone | Pilots I can see. Enterprise Sales Manager gets the Portfolio view here (see 7.1) |
| Pilot Library | Everyone | De-identified past pilots: practice area, use case, what was configured, which current pilots matched it |
| People | Everyone | Directory of ABC Inc. staff and firm contacts I can see |
| Quality | AI Enablement only | Run log of Pia's runs, acceptance checks, test set, connection health |

There is no top-level Connections tab (see 7.6).

**Inside a pilot**, a second row of tabs, sticky under the pilot header:
`Overview` · `Progress` · `Use cases` · `Gaps` · `Dummy data` · `Schedule` · `Team` · `Activity`

- Count badges where useful (use cases, open gaps, blocked drafts, open tasks).
- URL hash routing (`#/pilots/hv/progress`) so the back button and shared links work.
- Breadcrumbs: `Pilots / Harrow & Vale LLP / Progress`.

## 7. Views to build

### 7.1 Enterprise Sales Manager: Portfolio
One consolidated page, not a list of separate pages.
- **Headline tiles**: pilots by stage, pilots at risk, Legal Engineer hours short this week and next 4 weeks, decisions due this month.
- **Pilots table**: firm, stage, progress bar (stages done of 8), next milestone and date, success criteria agreed, risk, Legal Engineer capacity, priority. Sortable; row click opens the pilot.
- **Capacity coming up**: a per-pilot grid for the next 6 weeks. Rows are pilots, columns are weeks, cells show Legal Engineer hours needed vs staffed (green covered, amber short, red short by more than half). Hover a cell to see which stage drives the need (e.g. "First training, 2 sessions"). Totals row at the bottom. Capacity is per pilot, never a utilisation score per person.
- **Assign** from the grid: click a short cell, pick a Legal Engineer, it creates a task and updates staffing.
- **My tasks** panel on the same page: tasks assigned to the manager (e.g. "Approve extra Legal Engineer for Castellan & Rowe").

### 7.2 Pilot Overview and Team (Account Executive focus)
- **Overview**: firm summary, how the pilot is tracking (compact progress stepper, days left, decision date, success criteria status), what's agreed, what's next, open gaps, latest Pia run, primary action for the role.
- **Team tab**: workstreams with a DRI (directly responsible individual) for each. Seed: Pilot coordination (Account Executive), Use case design (Legal Engineer), Dummy data (Legal Engineer), Training and rollout, Firm IT and security (firm contact), Success measurement, Firm sponsor (firm contact). Each row: workstream, DRI avatar and name (clickable), status, next task and due date. Firm-side and ABC Inc.-side people are labelled.

### 7.3 Approvals inbox
- One list of everything waiting for the user's decision, newest first: Pia's draft plans, redrafted dummy data, re-runs after a new call, library entries, staffing requests.
- Each item: type, pilot, who or what raised it (Pia items carry the Pia tag), age, and inline actions (Review, Approve, Reject). Review opens the item in its pilot tab.
- Filters: All, Drafted by Pia, Staffing, Library. Empty state: "Nothing waiting for you."

### 7.4 My work (tasks)
- Tasks assigned to the user across pilots, grouped by Today, This week, Later, Done.
- Each task: title, pilot (clickable), due date, assigned by, status. Tick to complete; it updates the pilot's checklist and progress.
- Tasks come from the progress checklists (7.5) and from assignments by the Enterprise Sales Manager.

### 7.5 Progress and checklist (keep and strengthen)
- Stages: Discovery calls → Pia draft → Plan approved → Kickoff → First training → Live usage → Readout → Decision.
- Horizontal stepper on desktop, vertical on mobile. Each stage: status (done, current, upcoming, blocked), date (actual or planned), owner avatar.
- Checklist for the current stage, each item with owner, due date and a tick box. Items Pia can help with have a Pia button (e.g. "Ask Pia to draft the kickoff agenda").
- Success criteria tracker: each agreed criterion with target and status (Not started, On track, At risk, Met).
- Days remaining and the firm's decision date, with a warning if the readout lands less than two weeks before the decision.
- Seed realistic fictional progress for Lindenberg Hoffmann and Castellan & Rowe. Harrow & Vale moves forward as the demo runs (approval moves it to Plan approved and creates the kickoff checklist).

### 7.6 Connections: folded in, not a tab
A separate tab adds little for most users, so:
- **Pilot Overview** shows a small "Sources" row: Salesforce, Gong, Granola, Notion, Google Calendar, Slack, each a chip with last sync time. Click opens that source's events in Activity.
- **Weekly digests** live in Activity (filter "Digests") and in notifications. Seed four weeks of fictional history; clicking one shows it as it appeared in Slack. "Preview next digest" is a Pia button.
- **Connection health** (status, scope "deal team records only", reads only or writes after approval) lives in Quality, for AI Enablement.

### 7.7 Everything that names a thing is clickable
One link style (ink colour, underline on hover) and a hover preview card after a short delay.
| Entity | Opens |
| --- | --- |
| Firm | Firm summary page: profile, offices, practice areas, contacts, pilot, deal summary, calls |
| Person | Profile side panel: initials avatar, role, team, city and current local time, specialities, languages, pilots, capacity this week (ABC Inc. staff only), "Message in Slack" (toast only) |
| Call | Transcript panel with the source sentence highlighted |
| Use case | Detail panel: source, success criterion, library match, dummy data, edit history |
| Library entry | Library entry page: configuration, outcome, pilots that reused it |
| Practice area, stage, risk | Pilots list filtered by that value |

Add `PEOPLE`, `FIRMS`, `TASKS`, `WORKSTREAMS`, `CAPACITY` (per pilot per week) and `DIGESTS` to `data.js`. All fictional. Access rules apply: someone outside a deal team can't open that pilot's firm page, contacts or tasks.

## 8. App vs agent
Pia has its own visual identity, used everywhere Pia acts and nowhere else.
- **Pia accent**: a distinct colour (not the approval green; e.g. a soft violet) plus a small spark icon and the label "Pia".
- **Pia buttons** for every agent action: "Ask Pia to draft the plan", "Ask Pia to redraft", "Ask Pia to re-read the calls", "Ask Pia to propose slots", "Ask Pia to draft the kickoff agenda". "Ask Pia about this pilot" is shown disabled with a "Coming later" tooltip. App actions (approve, edit, assign, tick a task, copy invite) use normal buttons.
- **Pia content** has a thin Pia-coloured left border and a "Drafted by Pia" tag until approved; then "Approved by Tom Achebe, 18 Nov".
- **Pia panel**: collapsible right-hand panel in a pilot with the latest run's step trace, what Pia read and its questions. Fixed checks stay neutral grey with a "Check" label so it's clear they are code.
- While Pia runs, a Pia-coloured progress bar sits under the pilot header.

## 9. Visual style
Apply through CSS custom properties on `:root` only, with dark mode tokens under `prefers-color-scheme: dark`.
- Calm, editorial, legal-professional feel: warm off-white background, near-black text, generous white space, hairline borders, small radius, almost no shadow.
- One restrained accent (deep green) for primary actions and approved states. Most UI is black, white and greys.
- Inter for UI; an optional serif for page titles only. Larger, lighter page titles; small uppercase labels for section headers.
- Components: buttons (primary, secondary, ghost, destructive, Pia), chips, tabs, tables, cards, side panel, modal, toast, empty state, skeleton loader, avatar, stepper, progress bar.
- Responsive down to 375px: top tabs collapse into a menu; pilot tabs scroll sideways.

## 10. Usability standards
- One primary action per screen, top right of the header.
- Empty states say what will appear and offer one action.
- Skeleton loaders, not centred spinners.
- Confirm final actions in a modal that says what will happen.
- Keyboard: Tab and arrow keys through tabs, Escape closes panels, visible focus rings.
- Contrast at least 4.5:1; status never by colour alone; `aria-label` on icon buttons; side panels are dialogs with a focus trap.
- Tables: sticky header, sortable, row click opens the record.
- Toasts bottom right, auto-dismiss, Undo where it makes sense.

## 11. Keep working as today
- "Simulate events" panel (deal to pilot stage, follow-up call lands, model outage, start again), restyled, collapsible, with the line "All firms and people are fictional."
- Demo flow: Legal Engineer opens Harrow & Vale, triggers the run, sees the step trace, hovers sources, views a call, sees the blocked dummy draft, asks Pia to redraft, approves, sees the Slack summary.
- Role switching and access rules for all five roles.

## 12. Done means
- Everything in sections 5 to 8 is in the UI.
- No plain-text entity names left in tables, cards or headers.
- The 12 acceptance checks still pass.
- `./build.sh` produces a working `PilotHQ.html`, and `index.html` works on GitHub Pages.
- No real company names anywhere in the repo.
- README updated: navigation, roles and a short "Try it" path.
