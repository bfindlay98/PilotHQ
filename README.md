# PilotHQ

PilotHQ is where Growth teams set up legal AI pilots. Pia, the agent inside it, reads the discovery calls, the deal, past pilots and calendar availability, then drafts the pilot plan: use cases, success criteria, gaps to chase, dummy data and meeting slots. A Legal Engineer reviews and approves every draft.

All firms, people and documents are fictional.

## Try it
Open `PilotHQ.html` in a browser, or use the live link. No sign-in or setup.

1. As Tom Achebe (Legal Engineer), open **Harrow & Vale LLP**.
2. In **Simulate events**, move the deal to pilot stage. Watch Pia's run step by step.
3. Hover ❝ on any use case to see the sentence it came from, then **View in call**.
4. Check **Gaps** and **Dummy data** (one draft is blocked for naming a client of the firm).
5. **Approve plan**, then switch to **Growth leadership** to see every pilot.

Other things to try: a follow-up call landing before approval, a model outage, the **AI Enablement** view (acceptance checks and test set), and **Lars Berg**, who is not on the deal team.

## How it works
- `engine.js`: Pia's run. Fixed steps in code (consent check, source check, deal-fact screen, injection flag, slot finder) around the agent's reading and drafting.
- `data.js`: fictional calls, deals, past-pilot library and the drafts Pia returns.
- `app.js`, `index.html`: the PilotHQ interface.
- `./build.sh` bundles everything into `PilotHQ.html`.
