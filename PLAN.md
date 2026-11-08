# PLAN

## Concept
**DuePilot**: an AI collections and payments agent for freelancers and small businesses. Natural-language (typed or spoken) commands → PayPal invoices, reminders, cancellations and contractor payouts, each behind a human approval card, with webhook-driven reconciliation and an audit log.

**User story:** "As a freelance designer billing clients abroad, I want to say who owes me what and have invoicing, follow-ups and payment matching handled, so I get paid faster without awkward admin."

## PayPal capabilities used
| Capability | Endpoint | Where |
|---|---|---|
| OAuth2 client credentials (cached) | `POST /v1/oauth2/token` | `src/paypal.js` |
| Create draft invoice | `POST /v2/invoicing/invoices` | approval → create |
| Send invoice / get pay link | `POST /v2/invoicing/invoices/{id}/send`, `GET /v2/invoicing/invoices/{id}` | approval → send |
| Reminders | `POST /v2/invoicing/invoices/{id}/remind` | approval + scheduler |
| Cancel | `POST /v2/invoicing/invoices/{id}/cancel` | approval |
| Payouts | `POST /v1/payments/payouts` | approval + cap |
| Webhook signature verification | `POST /v1/notifications/verify-webhook-signature` | `/api/webhooks/paypal` |
| Idempotency | `PayPal-Request-Id` header, stable per action+step | all writes |

## AI
Gemini 2.5 Flash function calling (free tier), provider interface in `src/agent/providers.js`, keyless demo provider. Schema validation + caps in `src/agent/tools.js`.

## Milestones
- **Nov 8** ✅ Scaffold, PayPal client, agent, approvals, webhooks, UI, tests, README, render.yaml, submission + video docs.
- **Nov 9** Create sandbox app + keys (user); run full flow against real sandbox; fix API differences; deploy to Render; add webhook in sandbox app.
- **Nov 10** Feature freeze. Test with Gemini key. Screenshots in README. Fresh-clone QA.
- **Nov 11** Record + edit video; upload to YouTube (public).
- **Nov 12 morning IST** Submit on Devpost. Verify links, license in About.

- **Nov 8 (later)** ✅ Client risk insights + escalating reminder tone, AG Grid invoices grid (sponsor prize), demo sample data, time-saved KPI. 13 tests passing.

## Cut list (drop in this order if behind)
1. Voice input
2. Payouts (keep invoices)
3. Scheduled reminders (keep manual reminders)
4. Gemini (ship demo provider only; still AI-labelled honestly)

## Status / open risks
- Not yet run against real PayPal sandbox (no keys yet). Invoice payload follows Invoicing v2 docs; verify on Nov 9.
- Sandbox Payouts may need to be enabled on the sandbox business account.
