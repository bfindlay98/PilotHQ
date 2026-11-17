# PilotHQ

PilotHQ is where a Growth team sets up and runs legal AI pilots with law firms. **Pia**, the agent inside it, reads the discovery calls, the deal, past pilots and calendar availability, then drafts the pilot plan: use cases, success criteria, gaps to chase, dummy data and meeting slots. A Legal Engineer approves every draft. Anything Pia does is marked with ✦ in violet; everything else is the app.

All firms, people and documents are fictional. No sign-in or setup: open the live link or `PilotHQ.html`.

## Roles
Switch role from the menu at the top right.

| Role | Lands on | What to look at |
| --- | --- | --- |
| Tom Achebe, Legal Engineer | My work | Approvals inbox, Pia's draft, approve the plan |
| Sofia Lindqvist, Account Executive | My pilots | How each pilot is tracking, the Team tab (owners per workstream), the invite |
| Dana Whitfield, Enterprise Sales Manager | Portfolio | All pilots, capacity for the next 6 weeks, assign Legal Engineers, staffing approvals |
| Jo Reyes, AI Enablement | Quality | Acceptance checks, test set, Pia's runs, connections |
| Lars Berg, outside the deal team | My work | Can't open pilots he isn't staffed on |

## Try it
1. As Tom, open **Simulate events** (bottom left) and move Harrow & Vale to pilot stage. Watch Pia's run in the Pia panel.
2. In **Use cases**, hover ❝ to see the sentence each one came from; click a use case for detail, or a name for that person's profile.
3. In **Dummy data**, one draft is blocked for naming a client of the firm. Ask Pia to redraft it.
4. **Approve plan**, then open **Progress** to see the kickoff checklist.
5. Switch to Dana to see the portfolio and capacity coming up. Click a short week to assign someone.

## How it works
- `engine.js`: Pia's run. Fixed checks in code (consent check, source check, deal-fact screen, injection flag, slot finder) around the agent's reading and drafting.
- `data.js`: fictional calls, pilots, people, firms, tasks, capacity, library and the drafts Pia returns.
- `app.js`, `index.html`: the PilotHQ interface.
- `./build.sh` bundles everything into `PilotHQ.html`.
