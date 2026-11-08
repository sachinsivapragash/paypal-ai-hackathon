# Devpost submission (ready to paste)

> Replace every `<...>` before submitting. Claim nothing in the form that you did not show working.

## Project name
DuePilot

## Tagline (elevator pitch)
An AI collections agent for freelancers: say who owes you, approve the card, and PayPal invoices, reminds, reconciles and pays contractors for you.

## Inspiration
Freelancers and one-person businesses spend hours chasing payments: writing invoices, remembering who hasn't paid, sending awkward follow-ups and matching payments by hand. For solo workers billing clients across borders, a late invoice means a late rent payment. We wanted an assistant that doesn't just draft text but actually **does the work through PayPal**, while never moving money without the owner's say-so.

## What it does
- **Natural-language invoicing:** "Invoice Acme Corp ap@acme.com 450 USD for the logo work, net 7, remind them twice." The AI extracts client, email, amount, currency, terms and reminder count into a validated tool call.
- **Human-in-the-loop approval:** every action that touches PayPal appears as an approval card. Nothing is created, sent or paid until you click Approve.
- **Real PayPal invoices:** on approval DuePilot creates and sends a PayPal invoice and returns PayPal's hosted pay link.
- **Automatic follow-ups:** the reminders you approved are scheduled and sent through PayPal's invoice-reminder API; the AI writes polite ad-hoc reminders on request.
- **Auto-reconciliation:** PayPal's `INVOICING.INVOICE.PAID` webhook is signature-verified and de-duplicated, then the invoice flips to Paid and the cash-flow dashboard updates. A "Sync" button pulls status from PayPal as a fallback.
- **Contractor payouts:** "Pay maria@studio.com 120 USD for illustrations" → approval → PayPal Payouts, with a hard per-payout cap.
- **Cash-flow answers:** "Show unpaid invoices", "Cash flow summary".
- **Client risk insights:** "Who should I chase first?" ranks clients by average days to pay, late-payment rate and overdue balance. Reminder tone escalates politely for higher-risk clients.
- **Data grid** (AG Grid Community) for invoices: sort, filter, pay links, PayPal status sync.
- **Estimated admin time saved** KPI, so the impact is visible.
- **Audit log** of every proposal, approval, PayPal call, webhook and error.
- **Voice input** and a responsive UI that works on phones.
- **Keyless demo mode** so anyone can try every flow instantly.

## How we built it
Node.js + Express backend, vanilla JS frontend, JSON-file store. The agent loop sends the conversation plus 6 tool declarations to **Google Gemini 3.5 Flash (function calling)**. Tools that read data run immediately; tools that write only create *pending actions*. The approval endpoint is the only code path that calls PayPal's write APIs, and it uses a stable `PayPal-Request-Id` per action and step, so retries and double-clicks can never create duplicate invoices or payouts. The PayPal client handles OAuth token caching, retries on 429/5xx with the same idempotency key, and clear error messages. Webhooks are verified with PayPal's verify-webhook-signature API before any state changes. Hosted on Render.

## PayPal APIs used
OAuth2 · Invoicing v2 (create, send, get, remind, cancel) · Payouts · Webhooks (verify-webhook-signature; `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.CANCELLED`). Sandbox only.

## AI tools used and exactly how
- **Google Gemini 3.5 Flash** via the Generative Language REST API with **function calling**. It (1) turns free-text requests into structured tool calls (`create_invoice`, `send_reminder`, `cancel_invoice`, `pay_contractor`, `list_invoices`, `client_insights`, `cash_flow_summary`), (2) writes reminder messages, and (3) summarizes tool results for the user.
- **Guardrails outside the model:** all tool arguments are schema-validated in code (email, amount > 0, currency whitelist, terms 0-90 days, ≤3 reminders, invoice cap 5,000, payout cap 500); invalid calls are returned to the model as errors.
- **Provider-agnostic:** a one-method provider interface; a keyless deterministic demo provider emits the same tool calls when no API key is set (shown as "AI: demo" in the UI).
- Browser **Web Speech API** for voice input.
- <If you used an AI coding assistant to help build the project, say so here, e.g. "Development was assisted by Claude Code.">

## Challenges we ran into
Making an agent safe enough to touch money: we separated "propose" from "execute", enforced caps in code rather than in prompts, and designed idempotency keys so a retry after a network error never double-bills.

## Accomplishments that we're proud of
A full loop (request → approval → PayPal invoice → client pays → verified webhook → reconciled dashboard) with tests covering the agent flow, guardrails, idempotent retries and webhook signature verification.

## What we learned
PayPal's Invoicing, Payouts and Webhooks APIs; how to design tool-calling agents with human approval; why idempotency matters for payments.

## What's next
Multi-user accounts and Postgres; payout webhook reconciliation; WhatsApp/email intake; smarter reminder timing based on each client's payment history; multi-currency cash-flow forecasting.

## Built with
node.js, express, javascript, ag-grid, html, css, paypal-invoicing-api, paypal-payouts-api, paypal-webhooks, google-gemini, render

## Links
- Live demo: https://duepilot-4f2q.onrender.com
- Repo: https://github.com/sachinsivapragash/paypal-ai-hackathon
- Video: <https://youtu.be/...>

## Testing instructions for judges
1. Open the live demo. No login needed. Header badges show whether PayPal is **Sandbox** and which AI provider is active.
2. Click the first suggestion chip (or type: `Invoice Acme Corp <buyer sandbox email> 45 USD for logo work, net 7, remind them twice`) and press Send.
3. Review the approval card → **Approve**. The invoice appears as SENT with a PayPal pay link.
4. Open the pay link and pay with the PayPal **sandbox buyer** account:
   - Email: `sb-ratla53771659@personal.example.com`
   - Password: `<paste in the Devpost form only; not stored in the repo>` (sandbox only, no real money)
5. Return to DuePilot. Within seconds the invoice shows **PAID** (verified webhook). See the Audit log tab.
6. Try: `Who should I chase first?`, `Remind Acme`, `Pay <another sandbox email> 20 USD for illustrations`, `Cash flow summary`.
7. To run locally with no keys: `npm run setup && npm start` (demo mode).
