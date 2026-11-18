# PilotHQ

PilotHQ is where a Growth team runs legal AI pilots with law firms. **Pia**, the agent inside it, coordinates the pilot across Sales, Legal Engineering and the firm. Pia reads the discovery calls and pulls out what the firm asked for, in the firm's words. Then it makes three decisions inside a fixed boundary:

1. **Follow up gaps before asking.** If an idea is vague or has no success measure, Pia searches the other calls and the deal notes. If it still can't find it, it adds a question for the Account Executive to ask the firm.
2. **Propose a task owner.** For each idea, Pia proposes one Legal Engineer task and an owner, matched on speciality and then free hours. If nobody has time, it flags the task to the Enterprise Sales Manager.
3. **Choose a fallback when no meeting time works.** Pia splits the session by region or records it, and says why.

**Boundary, enforced in code:** read-only tools only, at most 10 tool steps per run, every run versioned (`pia-0.3`), repeat triggers skipped, and runs stop when the firm has two open deals. People decide everything that gets written. Anything Pia does is marked with ✦ in violet.

All firms, people and documents are fictional. No sign-in or setup: open https://pilothq.vercel.app or `PilotHQ.html`.

## Roles
Switch role from the menu at the top right.

| Role | Lands on | What they decide |
| --- | --- | --- |
| Tom Achebe, Legal Engineer | My work | Keep, merge, edit or drop each idea; name the use cases; confirm |
| Dana Whitfield, Enterprise Sales Manager | Portfolio | Confirm or change proposed owners; assign flagged tasks from Approvals or the capacity grid |
| Sofia Lindqvist, Account Executive | My pilots | Pick slots, copy the invite, mark it sent; ask the firm Pia's questions |
| Jo Reyes, AI Enablement | Quality | Acceptance checks, test set, learning trend, run log, health |
| Lars Berg, outside the deal team | My work | Can't open pilots he isn't staffed on |

## Try it (about 4 minutes)
1. As Tom, open **Simulate events** (bottom left) and move Harrow & Vale to pilot stage. Watch the Pia panel: reads, ideas, the source check removing one, gap follow-ups, owner proposals and the slot fallback.
2. **Ideas** tab: hover ❝ for the sentence each idea came from. Keep two, merge one, drop one, then **Confirm ideas**. That saves the pilot plan and posts the Slack summary.
3. Switch to Dana. **Approvals** shows proposed owners with reasons and one task with no owner. Confirm owners, then click Harrow & Vale's short week in the Portfolio capacity grid to assign the flagged task.
4. Switch to Sofia. **Schedule** shows the training split into two sessions by region. Copy an invite and mark it sent. **Overview** lists the questions for the firm.
5. **Activity** shows the Slack summary. Switch to Jo: **Quality › Learning** shows the trend and the labels from steps 2 and 3.

Also try: "Gong: follow-up call lands" before Tom confirms (Pia re-runs, keeps his edits and marks what changed), "same stage change again" (skipped), and "Model outage".

## How it works
- `engine.js`: Pia's run, read-only tools, step cap, the three decisions and the fixed checks.
- `data.js`: fictional calls, pilots, people, firms, tasks, capacity, learning store and the ideas the model returns.
- `app.js`, `index.html`: the PilotHQ interface and the 15 acceptance checks.
- `./build.sh` bundles everything into `PilotHQ.html`.
