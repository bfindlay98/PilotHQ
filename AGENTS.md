# AGENTS.md: PilotHQ v3 build brief

Instructions for a coding agent working on this repo. Read all of it before changing anything.

## 1. What this is

PilotHQ is an internal app for the Growth team at ABC Inc., a legal AI company that runs pilots with law firms before they buy. It holds one shared record per pilot.

**Pia** is the agent inside PilotHQ. Pia handles **coordination** across teams (Sales, Legal Engineering, the firm), time zones and a 30 to 90 day project. Pilot design (use cases, success criteria, dummy data) belongs to Legal Engineering, not Pia.

Pia is a **small agent**: one AI step pulls out ideas from the calls, then Pia makes **three decisions** inside a fixed boundary. People decide everything that gets written.

- **The app (PilotHQ)** is where people work: views, records, tasks, approvals, navigation.
- **The agent (Pia)** reads, follows up and proposes. Pia never confirms anything, never sends anything to a firm, and nothing it proposes is saved until the right person confirms that piece.

## 2. Repo, build and deploy

- Plain HTML, CSS and JavaScript. No framework, no build tools, no npm. Keep it that way.
- `data.js`: fictional data (calls, pilots, people, firms, tasks, capacity, digests, learning store, mock model output).
- `engine.js`: Pia's run, its tools and boundary, the three decisions, and the fixed checks (consent check, injection flag, source check, slot finder, slot check, repeat trigger, ambiguous deal, re-run merge, access rule). **Do not weaken these.**
- `app.js`: the UI, people's confirm actions and the 15 acceptance checks. `index.html`: markup shell and CSS.
- `./build.sh` bundles everything into `PilotHQ.html` (a single file that works offline). `index.html` loads the three scripts directly; both must keep working.
- Live site: https://pilothq.vercel.app (static, serves `index.html` and the three scripts).
- The model is mocked. Pia's ideas come from `MOCK_MODEL` in `data.js`. Do not add API calls or keys.

## 3. Content rules

- All firms, people, deals and documents are fictional. The company is always "ABC Inc.".
- Plain language. No em dashes. British spelling. No filler words.
- No commentary about the build in the UI: no "prototype", "V1", "tier", "mock", "demo".
- **Nothing in the UI says Pia designs the pilot.** Pia pulls out ideas in the firm's words; Legal Engineering turns them into use cases.
- Keep all 15 acceptance checks passing (`runAcceptanceChecks` in `app.js`). If you move code, update the checks; don't delete them.
- Nothing in the app sends anything to a firm. Invites are drafted; a person sends them.

## 4. Pia's boundary (enforced in `engine.js`)

- **Read-only tools only:** `readDeal`, `readCall`, `searchCalls`, `getFreeBusy`, `getCapacity` (`TOOLS`). There are no write tools; calling anything else throws.
- **At most 10 tool steps per run** (`MAX_STEPS`). On the cap Pia stops cleanly, keeps what is drafted and the trace says "Stopped at the step limit".
- **Every run is stamped `piaVersion`** (`PIA_VERSION`, currently `pia-0.3`), shown in the Pia panel and the run log.
- **Repeat trigger** for the same deal and stage within 10 minutes is skipped and logged with the reason.
- **Two open deals for one firm:** the run stops as "ambiguous", drafts nothing and asks the Account Executive which deal.
- Model down: the run stops cleanly with nothing written.

## 5. What Pia does in one run

Trace kinds: `fixed` (grey "Check"), `ai` (Pia violet), `decision` (Pia violet, "Decided"), `person`.

1. Start, consent check, injection flag (fixed).
2. Read the deal and the consented calls (ai). Use approved examples from past pilots in the same practice (learning store).
3. **Pull out ideas** (ai): `{id, text, practice, cite:{call,i,quote}, clarity:"clear"|"vague", successQuote}`. What the firm asked for, in the firm's words.
4. Source check (fixed): every idea's cite must resolve; the invented one is removed.
5. **Decision 1, follow up gaps.** For each vague idea or idea with no success quote, Pia searches the other consented calls and the deal notes. Found: quote attached, "Found in <call>". Not found: a question for the Account Executive to ask the firm.
6. **Decision 2, task owners.** One Legal Engineer task per idea ("Configure <idea> for the pilot", due before kickoff). Owner: speciality match, then most free hours. Nobody with the speciality and 4+ free hours: no owner, flagged to the Enterprise Sales Manager. Each proposal shows its reason ("Banking and Finance, 7 h free").
7. Slot finder (fixed): 08:00 to 18:00 local, internal free/busy.
8. **Decision 3, when no time works.** Pia picks one fallback and says why: split the session by region, or record it for the region that can't make it. Slot check (fixed) confirms every proposed slot.
9. Waiting for people (person).

## 6. People decide

| Person | Where | What they confirm | What their confirm writes |
| --- | --- | --- | --- |
| Tom Achebe, Legal Engineer | Pilot › Ideas | Keep, merge with, edit or drop each idea; names kept ones as use cases | Pilot plan (Notion) and Slack summary |
| Dana Whitfield, Enterprise Sales Manager | Approvals, capacity grid | Confirms or changes each proposed owner; assigns flagged tasks | Tasks in each owner's My work |
| Sofia Lindqvist, Account Executive | Pilot › Schedule, Overview | Picks slots, copies the invite, marks it sent; marks questions asked and records answers | Nothing outside PilotHQ |

Every decision becomes a label (idea kept, edited, merged, dropped; owner accepted, changed, assigned) for the Learning view.

## 7. Roles and navigation

| Role | Lands on | Tabs |
| --- | --- | --- |
| Legal Engineer | My work | My work, Approvals, Pilots, People |
| Account Executive | My pilots | My pilots, My work, People |
| Enterprise Sales Manager | Portfolio | Portfolio, My work, Approvals, People |
| AI Enablement | Quality | Quality, People |
| Outside the deal team (Lars Berg) | My work | My work, Pilots, People; can't open pilots he isn't staffed on |

Inside a pilot: `Overview` · `Progress` · `Ideas` · `Gaps` · `Schedule` · `Team` · `Activity`. Hash routing (`#/pilots/hv/ideas`).

Quality: `Acceptance checks` · `Test set` (ideas labelled / found / invented) · `Learning` (two trend lines from `LEARNING` and the latest labels) · `Run log` (version, steps used) · `Health` (Pia's boundary and connections).

**Coming later** appears in one place only: the Overview card "Later, if Legal Engineering wants it" (past-pilot library; firm-side tasks and contacts; draft success criteria; draft dummy data; Pia sends invites itself), as disabled Pia buttons with a "Coming later" tooltip.

## 8. Acceptance checks (`runAcceptanceChecks`)

1. One run ends waiting for people, with `piaVersion` on it.
2. Every idea resolves to a sentence in a consented call.
3. The invented idea is removed by the source check.
4. Gap follow-up: one idea gets a quote found in another call; one becomes a question; the trace shows both searches.
5. Owner proposal matches speciality and has 4+ free hours; one task has no owner and is flagged.
6. No time works for the training session; Pia proposes a split; every proposed slot passes the slot check.
7. A run stops cleanly at the step cap (forced low cap).
8. Calls without consent are skipped.
9. No recorded calls: nothing drafted.
10. Someone outside the deal team can't open the pilot.
11. Model down: run stops cleanly, nothing written.
12. Nothing is written before a person confirms; each confirm writes only its own piece.
13. Re-run after a new call keeps Tom's edits and marks what changed.
14. Repeat trigger is skipped with a reason.
15. Every read, decision, check and confirmation is in the activity log.

Checks 12 and 15 run the real confirm actions against a throwaway app state (`sandbox` in `app.js`).

## 9. Visual style and usability (unchanged from v2)

CSS custom properties on `:root` with dark mode tokens; calm editorial look; one deep green accent for confirmed states; Pia has its own violet with a ✦ spark, used only where Pia acts. One primary action per screen. Confirm final actions in a modal that says what will be written. Responsive to 375px with no sideways page scroll. Simulate events panel (stage change, same stage change again, follow-up call, model outage, start again) stays.

## 10. Done means

- Everything above is in the UI and all 15 checks pass.
- `./build.sh` produces a working `PilotHQ.html`; `index.html` still works.
- No real firm or person names; the company is ABC Inc.
