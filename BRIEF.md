# Project brief: PayPal AI Hackathon ("Build What's Next with PayPal and AI")

Solo entrant (college student, Coimbatore, India, IST). Devpost-hosted, sponsored by PayPal. Rules: https://paypalaihackathon.devpost.com/rules

## Deadline
Submission closes **Nov 12, 2026, 12:00 pm PT = Nov 13, 2026, 1:30 am IST**. Target: feature-complete Nov 10, polish + video Nov 11, submit by Nov 12 morning IST (12+ hour buffer). Judging Dec 1-15, 2026; winners about Dec 21.

## Prizes
Grand $12k / $8k / $5k. Honorable mentions $5k each: Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce. Sponsor prizes: AG Grid, APIMatic, Bryntum, Channel3, Render credits. One Grand **or** one Honorable Mention, **plus** one Sponsor prize.

## Mandatory requirements
1. PayPal developer platform (sandbox) is central, not decorative.
2. AI meaningfully integrated into core functionality.
3. Working prototype that judges can run or open at a hosted URL.
4. New project or significant update during Oct 1 - Nov 12, 2026, with real commit history.
5. Original work owned by the entrant; open-source used per license; no support from PayPal/Devpost.
6. English.

## Submission checklist
- [ ] Text description of features and functionality
- [ ] Which AI tools/services were used and exactly how
- [ ] Public repo with all source, assets and run instructions
- [ ] Open-source license file, visible in the repo About section (MIT)
- [ ] Functional demo: hosted URL + README setup
- [ ] Free, unrestricted test access through Dec 15, 2026; sandbox buyer test account documented
- [ ] Demo video < 3:00, public on YouTube, no copyrighted music, minimal factual PayPal branding
- [ ] App matches the video and description exactly
- [ ] No secrets committed (`.env.example` only)
- [ ] One strong entry

## Judging
Stage 1 pass/fail (fits theme, truly uses PayPal + AI). Stage 2, equally weighted: Technological Implementation, Design, Potential Impact, Innovation, Presentation (ties broken in that order). Judges may use AI-driven analysis, so README and repo must be crisp and machine-readable.

## Strategy
Agentic AI that takes real PayPal actions via tool calling, with human approval, spending caps and an audit log → targets Grand + Best Use of Agentic Commerce / PayPal + AI. Host on Render (sponsor prize). Concrete audience: freelancers and small businesses. Tight 2:45 video with a live sandbox payment.

## Tech guidance
Node/Express, small DB, sandbox only, never real card data. AI: Gemini free tier with function calling (swappable provider) + keyless demo mode. Secrets via env vars. Webhook signature verification. Idempotency keys on payment-creating calls.
