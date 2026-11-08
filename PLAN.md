# PLAN: PayPal AI Hackathon entry

Deadline: **Nov 13, 2026 1:30 am IST** (Nov 12, 12:00 pm PT). Target submit: Nov 12 evening IST.

## Concept: "InvoicePilot", an AI collections and payments agent
Freelancers and small businesses type or speak plain-language commands. The agent turns them into real PayPal sandbox actions, with a human approval step before any money-related action.

Example: "Invoice Acme 450 USD for logo work, due in 7 days, remind them twice."

### Understanding in 5 bullets
1. PayPal sandbox must be central: Invoicing API (create/send/remind), Orders/Checkout (pay link), Webhooks (payment events), Payouts (pay contractors, capped).
2. AI is the core interface: Claude with tool use parses commands, drafts invoices and writes reminder messages. Every money action shows a preview and needs approval.
3. Target prizes: Best Use of Agentic Commerce, Best Use of PayPal + AI, Most Impactful. Sponsor prize: Render (host there). Optional: AG Grid for the invoices table.
4. Judged on implementation, design, impact, innovation, presentation. The video (under 3 min, YouTube) must show a full sandbox payment completing.
5. Must ship: public repo, MIT license, hosted demo plus README run steps, text description, AI-tools description. No secrets in git.

## Architecture
- Backend: Node.js + Express. Store: SQLite (single file, easy to demo).
- Frontend: simple responsive web UI (chat panel + invoices table + audit log).
- AI: Google Gemini API free tier (function calling), swappable provider, plus keyless demo mode. Tools: `create_invoice`, `send_invoice`, `list_invoices`, `send_reminder`, `create_payout`, `cashflow_summary`.
- Guardrails: approval step before send/payout, amount caps, schema validation, audit log table.
- PayPal: sandbox REST. OAuth token, Invoicing v2, Orders v2, Payouts, Webhooks with signature verification, idempotency keys (PayPal-Request-Id).
- Deploy: Render web service (free tier) + env vars for keys.

## Milestones
| When (IST) | Goal |
|---|---|
| Nov 8 (today) | Repo, plan, scaffold, sandbox keys, PayPal OAuth + create invoice working |
| Nov 9 | AI tool-use chat creating and sending invoices with approval; webhook reconciliation |
| Nov 10 | Reminders, payouts with caps, cashflow summary, UI polish; deploy to Render |
| Nov 11 | Tests, README, DEVPOST_SUBMISSION.md, record video |
| Nov 12 | Final QA from clean clone, upload video to YouTube, submit by evening IST |

## Cut-list (drop first if behind)
1. Payouts, 2. voice input, 3. AG Grid, 4. cashflow summary charts.
Never cut: invoice creation, approval step, webhook reconciliation, README, video.

## Needs from the user
- PayPal sandbox app (client ID and secret) in local `.env` / Render env vars.
- A PayPal sandbox business account (merchant) and personal account (buyer).
- Gemini API key (free, aistudio.google.com).
- Voice-over and screen recording; YouTube upload; final Submit on Devpost.
