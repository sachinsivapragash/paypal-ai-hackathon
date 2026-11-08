// Demo-mode sample history so the dashboard and insights have something real to show.
// Only reachable when PayPal runs in demo mode; never mixed with sandbox data.
const DAY = 86400000;
const iso = (d) => new Date(d).toISOString();
const date = (d) => iso(d).slice(0, 10);

function seedDemo(store, now = Date.now()) {
  const rows = [
    // client, email, amount, description, sentDaysAgo, net, paidDaysAfterSend (null = unpaid)
    ['Brightline Studio', 'accounts@brightline.example.com', 1200, 'Brand identity package', 40, 14, 9],
    ['Brightline Studio', 'accounts@brightline.example.com', 650, 'Social media templates', 12, 14, 6],
    ['Northwind Cafe', 'owner@northwind.example.com', 320, 'Menu redesign', 35, 7, 21],
    ['Northwind Cafe', 'owner@northwind.example.com', 280, 'Website photo edits', 18, 7, null],
    ['Kestrel Labs', 'finance@kestrel.example.com', 2400, 'Landing page build', 25, 30, 12],
    ['Kestrel Labs', 'finance@kestrel.example.com', 900, 'A/B test variants', 4, 30, null],
    ['Orchid Events', 'hello@orchid.example.com', 450, 'Event poster series', 20, 7, null],
  ];
  let n = 2000;
  for (const [clientName, clientEmail, amount, description, ago, net, paidAfter] of rows) {
    const sent = now - ago * DAY;
    const paid = paidAfter == null ? null : sent + paidAfter * DAY;
    const id = store.id('inv');
    store.upsertInvoice({
      id, paypalId: `INV2-DEMO-SEED${++n}`, number: String(n), clientName, clientEmail, amount, currency: 'USD', description,
      status: paid ? 'PAID' : 'SENT', sentAt: iso(sent), createdAt: iso(sent), dueDate: date(sent + net * DAY),
      paidAt: paid ? iso(paid) : undefined, payLink: `/demo-pay/INV2-DEMO-SEED${n}`,
      remindersLeft: paid ? 0 : 2, remindersSent: paid ? 1 : 0, nextReminderAt: paid ? null : iso(now - 60000),
    });
  }
  store.audit('demo', 'seeded_sample_history', { invoices: rows.length });
}

module.exports = { seedDemo };
