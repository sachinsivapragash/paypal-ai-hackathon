# Meta VR Start Developer Competition: submission draft

**Check the official rules on Devpost first.** They were behind a bot check when this was written, so confirm the required build type (for example, a Quest app versus a WebXR link), whether a project that existed before the competition can be entered, the video length and the deadline (Nov 19, 2026, 1:30 am IST).

## Name
Tallyspace

## Tagline
Hold your unpaid invoices in your hands: a mixed-reality cash-flow room where you throw an invoice into a bin to chase it, and approve real PayPal actions by setting a tablet down.

## What it does
- **Receivables as physical objects:** each invoice is a block. Height shows the amount and colour shows the status (amber sent, red overdue and pulsing, green paid). Blocks are arranged on a timeline arc, with the most overdue on the left.
- **Throw to act:** throw an invoice into **Remind**, **Cancel** or **Sync PayPal**. Remind and Cancel only *propose* the action. An approval tablet appears on your desk, and you drop it in the green **APPROVE** slot to execute it through PayPal, or in **Reject** to discard it. A human always approves anything that moves money.
- **Talk to the agent:** a mic orb uses Web Speech to send what you say to the Gemini agent, and the agent's reply is spoken back to you. For example, "Invoice Acme ap@acme.com 300 USD for logos" turns into a tablet on your desk.
- **Scan-to-pay:** when you pick up an unpaid invoice, its PayPal QR code appears on a floating panel.
- **Client risk orbs:** a sphere for each client, sized by the amount they owe and coloured by payment risk.
- **Live cash-flow wall** (paid, outstanding and overdue), plus an **audit log** panel.
- **A chime when money arrives:** when PayPal's verified webhook marks an invoice paid, a chime plays and the block turns green.
- **Weekly briefing** (Gemini, read aloud) and **payment matching** (PayPal Transaction Search), each available with one button.
- **Mixed reality:** passthrough mode puts the ledger on your real desk. Also supports VR mode, controllers or hand tracking (pinch), haptics, and a desktop and phone fallback.

## How it's built
- three.js WebXR (`immersive-vr` and `immersive-ar`, hand tracking, haptics) in `public/vr/`, served by the DuePilot Node.js backend.
- Live connections: the PayPal sandbox (Invoicing v2, Orders v2, Transaction Search, verified webhooks) and Google Gemini function calling.
- All writes go through DuePilot's single approval endpoint, which uses idempotency keys.

## Try it
- In the main web app, the header has a **🥽 Tallyspace VR** button.
- Open https://duepilot-4f2q.onrender.com/vr/ in the Meta Quest Browser, then press **Enter MR** or **Enter VR**.
- On a laptop, drag invoices into the bins with the mouse. Press **Sample data** for an offline demo.
