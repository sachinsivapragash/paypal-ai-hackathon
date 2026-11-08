# Demo video script (target 2:40, hard max 2:50)

Record at 1920×1080, browser zoom 110-125%, real sandbox mode (badges show "PayPal: Sandbox", "AI: gemini"). No music, or royalty-free/none. Do one full dry run first; reset data before recording.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00-0:15 | Title card: "DuePilot: an AI collections agent on PayPal" | "Freelancers lose hours every month chasing payments: writing invoices, remembering who hasn't paid, sending awkward reminders. DuePilot does that work for you, through PayPal." |
| 0:15-0:25 | App, empty dashboard, point at badges | "This is running live on Render against the PayPal sandbox, with Google Gemini as the agent." |
| 0:25-0:45 | Click mic, speak: "Invoice Acme Corp, [buyer email], 45 dollars for the logo work, net 7, remind them twice" → Send | "I just say what I need. Gemini turns it into a structured tool call: client, amount, terms, reminders." |
| 0:45-1:00 | Approval card, hover fields | "Nothing touches PayPal yet. Every action that moves money or contacts a client needs my approval, and amounts are capped in code." |
| 1:00-1:15 | Approve → row appears SENT, pay link | "Approved. DuePilot created and sent a real PayPal invoice, with an idempotency key so a retry can never double-bill." |
| 1:15-1:45 | Open pay link → PayPal sandbox page → log in as buyer → pay | "Now I'm the client. I pay on PayPal's own invoice page with a sandbox buyer account." |
| 1:45-2:00 | Back to DuePilot: row flips to PAID, KPIs update, Audit log tab shows `reconciled_payment` | "PayPal sends a webhook. DuePilot verifies its signature, de-duplicates it and reconciles the payment automatically." |
| 2:00-2:15 | Type "Pay maria@… 20 USD for illustrations" → card → Approve → Payouts tab | "It also pays my contractors through PayPal Payouts, under a per-payout limit." |
| 2:15-2:25 | Type "Cash flow summary" | "And it answers questions about my cash flow." |
| 2:25-2:40 | Architecture slide or README diagram | "Under the hood: PayPal Invoicing, Payouts and verified webhooks; Gemini function calling with schema-validated tools; human approval; a full audit log; and tests. DuePilot: get paid without chasing." |

## Checklist before upload
- [ ] Under 3:00 · [ ] every feature shown actually works live · [ ] no secrets visible (don't show `.env` or the Render env page) · [ ] no copyrighted music · [ ] YouTube visibility **Public** · [ ] link opens in a private window
