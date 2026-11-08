# DuePilot: an AI collections agent on PayPal

> Tell it who owes you money in plain English. DuePilot drafts the PayPal invoice, waits for your approval, sends it, chases payment with polite reminders, reconciles the payment from PayPal webhooks, and pays your contractors via PayPal Payouts, all under spending caps with a full audit log.

**Live demo:** `https://<your-render-app>.onrender.com` (replace after deploying) · **Video:** `<YouTube link>` · **License:** MIT

## The problem
Freelancers and micro-businesses, especially solo workers billing international clients from places like India, lose hours every month on admin: writing invoices, remembering who hasn't paid, sending awkward follow-ups, and matching payments to invoices. Most stop chasing after one reminder. Late payment is a cash-flow problem, not an accounting problem.

## What DuePilot does
| You say | DuePilot does (PayPal API) |
|---|---|
| "Invoice Acme Corp ap@acme.com 450 USD for the logo work, net 7, remind them twice" | Validates the request, shows an **approval card**, then creates a draft invoice (`POST /v2/invoicing/invoices`) and sends it (`POST /v2/invoicing/invoices/{id}/send`), returning PayPal's hosted pay link |
| *(nothing: it's automatic)* | Schedules the reminders you approved and sends them (`POST /v2/invoicing/invoices/{id}/remind`) |
| *(client pays)* | Receives `INVOICING.INVOICE.PAID`, **verifies the signature** (`POST /v1/notifications/verify-webhook-signature`), de-duplicates, marks the invoice paid, updates cash-flow KPIs |
| "Remind Acme" | The AI writes a warm reminder, you approve, PayPal sends it |
| "Cancel Initech" | Approval, then `POST /v2/invoicing/invoices/{id}/cancel` |
| "Pay maria@studio.com 120 USD for illustrations" | Approval + cap check, then PayPal Payouts (`POST /v1/payments/payouts`) |
| "Who should I chase first?" | Ranks clients by payment risk (average days to pay, late-payment rate, overdue balance). Automatic reminders get firmer, but stay polite, for higher-risk clients |
| "Show unpaid invoices" / "Cash flow summary" | Read-only answers from your ledger |

## Dashboard
- **Invoices grid** built on AG Grid Community: sort, filter, resize, pay links and a per-row PayPal status sync.
- **Client insights:** risk level, amount owed, average days to pay and late rate per client.
- **KPIs:** collected, outstanding, overdue, and an *estimated* admin time saved (12 min per invoice, 5 per reminder, 6 per reconciliation or payout; clearly labelled as an estimate).
- **Audit log**, **voice input**, responsive down to phone width, light and dark themes.
- **Load sample data** (demo mode only) fills in a realistic client history so insights have something to show.

## Why it's different
- **Agentic, but safe.** The model can only *propose* actions through typed tools. Every write to PayPal goes through a human approval card. Caps on invoice and payout amounts are enforced in code (not in the prompt), and every proposal, approval, API call and webhook lands in the audit log.
- **Closes the loop.** Most "AI invoice" demos stop at generating a PDF. DuePilot sends through PayPal, collects, reconciles from webhooks and follows up.
- **Runs with zero keys.** A keyless demo mode (a local PayPal simulator plus a rule-based "model" that emits the same tool calls) lets anyone try every flow instantly.

## Architecture
```
Browser (chat · approval cards · invoices/payouts/audit · voice input)
        │  REST
Express server (src/app.js)
 ├─ Agent loop (src/agent)  ── LLM provider: Gemini function calling | keyless demo
 │     tools.js: schema-validated tools → create PENDING actions (no side effects)
 ├─ Approvals /api/actions/:id/approve ── the only path that writes to PayPal
 │     stable PayPal-Request-Id per action+step → retries never duplicate
 ├─ PayPal client (src/paypal.js): OAuth2 (cached) · Invoicing v2 · Payouts · Webhook verify
 │     retries 429/5xx with the same idempotency key; demo simulator with the same interface
 ├─ Webhooks /api/webhooks/paypal: verify signature → dedupe event id → reconcile
 ├─ Reminder scheduler (every 5 min) + manual "Run reminders"
 └─ JSON store (data/db.json): invoices, pending actions, payouts, audit log
```

## AI: what's used and how
- **Google Gemini (`gemini-2.5-flash`, free tier) with function calling.** The model gets 7 tool declarations (`create_invoice`, `send_reminder`, `cancel_invoice`, `pay_contractor`, `list_invoices`, `client_insights`, `cash_flow_summary`). It extracts structured invoice data from free text, writes reminder copy, and chains tool results into a short answer.
- **Guardrails in code:** every tool argument is validated (email format, positive amount, supported currency, net 0-90 days, 0-3 reminders, caps). Invalid calls return errors to the model so it asks the user instead of guessing.
- **Swappable provider:** `src/agent/providers.js` defines a one-method interface (`step(history, tools)`). Adding Claude/OpenAI is a ~30-line adapter.
- **Demo provider:** no key? A deterministic parser emits the same tool calls, so the product still works end to end. The UI badge shows which provider is active.

## Run it locally (2 minutes)
Requires Node.js 20+.
```bash
git clone https://github.com/sachinsivapragash/paypal-ai-hackathon.git && cd paypal-ai-hackathon
npm run setup     # installs deps and creates .env from .env.example
npm start         # http://localhost:3000
```
With an empty `.env` it starts in **demo mode**: try the suggestion chips, approve a card, open the pay link, click "Simulate buyer payment", and watch the invoice reconcile.

Run the tests: `npm test` (agent flow, guardrails, idempotency, retries, webhook signature verification, Gemini mapping).

## Use the real PayPal sandbox
1. Log in at https://developer.paypal.com → **Testing Tools → Sandbox Accounts** → create a **US Business** and a **US Personal** account. Then **Apps & Credentials** → **Sandbox** → *Create App* (Merchant, linked to the US business account) → under *Features* tick **Invoicing** → *Save Changes*. Copy the Client ID and Secret into `.env` as `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.
2. **Testing Tools → Sandbox Accounts:** note the *Business* account email (put it in `PAYPAL_INVOICER_EMAIL`) and the *Personal* (buyer) account. You'll pay invoices with the buyer.
3. In your app, **Add Webhook** with URL `https://<your-host>/api/webhooks/paypal` and events `Invoicing invoice paid` and `Invoicing invoice cancelled`. Copy the Webhook ID into `PAYPAL_WEBHOOK_ID`. (Webhooks need a public URL: use the Render deployment.)
4. Optional: free Gemini key from https://aistudio.google.com/apikey → `GEMINI_API_KEY`.
5. Restart. The header badges show **PayPal: Sandbox** and **AI: gemini**.

Sandbox only: the server refuses to start if `PAYPAL_API_BASE` isn't a sandbox URL.

## Deploy on Render
Fork/push this repo → Render → **New → Blueprint** → select the repo (uses `render.yaml`) → fill the secret env vars in the dashboard. Note: the free plan's disk is ephemeral, so demo data resets on redeploy.

## Test access for judges
- Hosted URL above. No login required.
- PayPal sandbox buyer account for paying invoices: listed in the Devpost submission's testing instructions (sandbox-only, no real money).

## Environment variables
See [`.env.example`](.env.example). Every key is optional; missing keys switch that part to demo mode.

## Limitations (honest)
- Single-user demo: no auth, JSON-file storage. Production would need accounts and a real database.
- Use **US** sandbox accounts. PayPal blocks Payouts from India-registered accounts (`PAYOUT_NOT_AVAILABLE`) and payments between two India sandbox accounts.
- New sandbox apps have **Invoicing** switched off: enable it under the app's *Features* and save (it can take a minute to apply).
- Payout webhooks are not reconciled yet (status comes from the create response).
- Voice input uses the browser's Web Speech API (Chrome/Edge).

## Third-party
Express (MIT), dotenv (BSD-2-Clause), AG Grid Community 32.3.3 (MIT, loaded from the jsDelivr CDN; the app falls back to a plain table if it fails to load). PayPal REST APIs (sandbox) and the Google Gemini API are used under their developer terms. No other assets.

## License
MIT. See [LICENSE](LICENSE).
