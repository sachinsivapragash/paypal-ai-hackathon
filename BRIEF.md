# MISSION: Win the PayPal AI Hackathon ("Build What's Next with PayPal and AI")

You are my senior full-stack/AI engineer and hackathon strategist. Build a winning submission end to end. Read this whole brief first, then plan, then build. Ask me only for things you cannot do yourself (accounts, API keys, my voice in the video).

## STATUS / WHO I AM
- I am registered on Devpost for this hackathon as a SOLO entrant (individual). I am a college student in Coimbatore, India (IST, UTC+5:30), comfortable with JavaScript/Node.js/Express and Python, intermediate with AI apps, NEW to PayPal APIs. Explain PayPal-specific steps clearly and do the heavy lifting.
- This repo is the hackathon repo. It is public, MIT licensed, and started inside the submission window. Put this brief in the repo as `BRIEF.md` and keep `PLAN.md` updated.
- My PayPal sandbox client ID/secret go in a local `.env` that I will create myself. Never ask me to paste secrets in chat and never commit them.

## 0. HARD DEADLINE
- Submission closes **Nov 12, 2026, 12:00 pm PT** = **Nov 13, 2026, 1:30 am IST**. Today is Nov 8 (about 4 days left).
- Target: feature-complete by end of Nov 10, polish and video on Nov 11, submit by Nov 12 morning IST (leave a 12+ hour buffer). Never leave the submission to the last hour.
- Scope ruthlessly: ONE polished, working end-to-end flow beats many half-built features.

## 1. EVENT FACTS
- Host: Devpost, sponsor PayPal. Global online. Themes: Low/No Code, Machine Learning/AI, Web.
- Page: https://paypalaihackathon.devpost.com/ (rules at /rules)
- Judging: Dec 1 to Dec 15, 2026. Winners about Dec 21, 2026.
- Prizes ($67,500 cash): Grand 1st $12,000 / 2nd $8,000 / 3rd $5,000. Honorable mentions $5,000 each: Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce. Sponsor prizes: AG Grid ($5k/$2k/$1k), APIMatic ($1k x3 + subscription), Bryntum ($1k x3), Channel3 ($1.5k), Render credits ($1k/$750/$500).
- A project can win one Grand Prize OR one Honorable Mention, PLUS one Sponsor Prize. So integrating 1-2 sponsor tools genuinely is free upside.

## 2. ELIGIBILITY (I must satisfy)
- Individual or team, above legal age of majority in my country. Teams appoint one Representative. Not open to residents of sanctioned regions, PayPal/Devpost staff and families, judges. (I am in India, which is eligible. Confirm nothing in the rules contradicts this.)

## 3. MANDATORY PROJECT REQUIREMENTS
1. Integrate the **PayPal developer platform (free sandbox)** and make it CENTRAL, not decorative. (PayPal family also counts: Venmo, Braintree, Payouts/Hyperwallet, Zettle, etc.)
2. Meaningfully integrate **AI** (any model/tool/platform) into core functionality.
3. A **working prototype**, not mockups or static demos. Judges must be able to run it or open a hosted URL.
4. New project, or an existing one significantly updated during Oct 1 to Nov 12, 2026. Start a NEW repo with real commit history inside this window.
5. Original work, solely owned by me. Open-source components allowed if licenses are followed. Third-party SDKs/APIs/data must follow their licenses. No financial or preferential support from PayPal/Devpost for the project.
6. English only (or full English translation).

## 4. SUBMISSION CHECKLIST (any miss can mean disqualification)
- [ ] Text description of features and functionality
- [ ] Description of which AI tools/services were used and exactly how
- [ ] **Public repo** (GitHub/GitLab/Bitbucket) with ALL source code, assets, and run instructions
- [ ] **Open-source license** file, visible in the repo's About section (use MIT or Apache-2.0; set it in GitHub About/sidebar)
- [ ] **Functional demo**: a hosted URL (preferred; deploy free on Render, which also targets the Render prize) AND README setup/run instructions
- [ ] Testing access free and unrestricted through Dec 15, 2026. If anything is gated, provide test credentials in the submission. Hosted demo must stay up and have a PayPal sandbox buyer test account documented.
- [ ] **Demo video under 3:00**, public on **YouTube**, link on the form. Shows the project actually working on the device it was built for. NO copyrighted music, NO unlicensed third-party logos/trademarks beyond what's needed for PayPal integration (keep PayPal branding minimal and factual).
- [ ] The app must run consistently and match the video and text description exactly (no claiming features that don't work).
- [ ] No secrets committed. Use `.env.example`; keep real keys out of git history.
- [ ] Multiple entries allowed but each must be substantially different. Submit ONE strong entry.

## 5. HOW I'LL BE JUDGED
Stage 1 (pass/fail): reasonably fits the theme and truly uses PayPal + AI.
Stage 2, five EQUALLY weighted criteria:
1. **Technological Implementation**: skillful, non-trivial use of PayPal APIs AND AI. Use several PayPal capabilities (e.g. Orders/Checkout, Invoicing, Payouts, Subscriptions, Webhooks, Disputes/Transaction Search), handle errors, verify webhook signatures, idempotency, clean architecture, tests.
2. **Design**: complete, coherent product. Real UX with loading/error/empty states, responsive, branded, not a bare API demo.
3. **Potential Impact**: credible real problem and real audience. Name the user (e.g. freelancers, small merchants in emerging markets) and quantify the pain.
4. **Innovation/Idea**: novel angle vs. existing chatbots/checkout widgets.
5. **Presentation**: the video. Clear problem, audience, value, and a flawless end-to-end live run.
Ties are broken criterion by criterion in that order, then a judges' vote. Judges may also use automated AI-driven analysis, so the README, repo structure, and description must be crisp and machine-readable too.

## 6. WINNING STRATEGY (design the project to stack prizes)
Aim to qualify for the Grand Prize AND honorable mentions AND a sponsor prize:
- **Best Use of Agentic Commerce + Best Use of PayPal + AI**: build an AI AGENT that takes real actions through PayPal (tool/function calling) with human-in-the-loop approval, spending limits, and an audit log. Look at PayPal's agent tooling (PayPal Agent Toolkit / MCP server, if available in docs) and use it where it fits.
- **Most Impactful**: pick a concrete underserved audience and show before/after time or money saved.
- **Best Demo Delivery**: tight, rehearsed 2:45 video with live sandbox payment completing on screen.
- **Sponsor prizes (pick 1-2 that fit naturally; do not bolt on)**: Render (host the app, easiest win), AG Grid (a rich transactions/data grid), Bryntum (scheduler/Gantt/calendar views), Postman (collection for the API), Zapier (automation hooks), Elastic (search), APIMatic (SDK/context plugin to speed up PayPal integration).

### Recommended concept (use unless you find a clearly stronger one; justify any change in 5 lines)
**"An AI collections and payments agent for freelancers and small businesses"**: user types or speaks natural-language commands ("Invoice Acme 450 USD for the logo work, net 7, remind them twice"). The agent drafts the PayPal invoice, shows a preview for approval, sends it, listens to PayPal webhooks, auto-reconciles payments, sends polite AI-written reminders, summarizes cash flow, and can pay contractors via Payouts under approval rules. Dashboard with AG Grid for invoices/transactions. Everything runs on PayPal sandbox. Hosted on Render.
Alternatives if you can argue better: AI shopping/checkout agent for a merchant storefront; AI dispute-evidence assistant; AI expense-splitting with Venmo-style payouts.

## 7. YOUR WORKING PROCESS
1. **First 15 minutes**: skim the live pages https://paypalaihackathon.devpost.com/ and /rules and https://developer.paypal.com/ docs for the exact APIs you'll use. Confirm the rules above still match; report any difference.
2. Write `PLAN.md`: chosen concept, user story, architecture diagram (text), PayPal endpoints used, AI model/tooling, 4-day milestone list, cut-list of features to drop if behind.
3. Scaffold the repo: README, LICENSE (MIT), `.env.example`, `.gitignore`, CI lint/test, clear folder structure. Commit early and often with meaningful messages (judges can see real in-window history).
4. Build vertical slice FIRST (sandbox payment + AI call working end to end), then widen, then polish UI.
5. Add tests for the PayPal flow and webhook verification. Add seed/demo data and a one-command setup (`npm run dev` or `docker compose up`).
6. Deploy to Render early (day 2), not at the end. Keep it up through Dec 15.
7. Produce: polished README (problem, solution, architecture diagram, screenshots, setup, env vars, sandbox test accounts, AI tools used and how, limitations, license), `DEVPOST_SUBMISSION.md` (ready-to-paste text for every form field), and `VIDEO_SCRIPT.md` (shot-by-shot, under 2:50, with timestamps).
8. Final QA: fresh clone, follow only the README on a clean machine, confirm it works; check no secrets in git history; verify the YouTube link is public; verify the license shows in repo About.

## 8. TECH GUIDANCE
- Stack: pick what ships fastest and is robust (e.g. Next.js or Node/Express + a small DB such as SQLite/Postgres). Stay in PayPal **sandbox** only; never ask for or store real card data.
- AI: I have NO paid API key. Use the Google Gemini API FREE tier (function calling) as the default model via a small swappable provider interface (so Groq or Claude can be dropped in). Add a keyless DEMO MODE (deterministic parser) so the app and video never break. Never hard-code keys. Add guardrails: approval step before any money moves, amount caps, structured outputs validated with a schema, audit log.
- Secrets via env vars only. Webhook signature verification required. Idempotency keys on payment-creating calls.
- Keep dependencies licensed permissively; list third-party assets and licenses in README.

## 9. WHAT I NEED FROM YOU AT THE END
- Public-ready repo, deployed URL, and a checklist showing every item in section 4 as DONE or BLOCKED-ON-ME.
- A list of exactly what I must do personally (Devpost account/registration, create PayPal sandbox account and paste keys, record my voice for the video, upload to YouTube, click Submit).
- Never claim something works unless you ran it. Be honest about gaps.

Start now: confirm understanding in 5 bullets, then begin step 7.1 and 7.2.
