const config = require('./config');
const { createApp } = require('./app');

const app = createApp(config);
// Check for due reminders every 5 minutes.
setInterval(() => { app.locals.runDueReminders().catch(() => {}); app.locals.runRecurring().catch(() => {}); }, 5 * 60_000).unref();

app.listen(config.port, () => {
  console.log(`DuePilot running on http://localhost:${config.port}`);
  console.log(`PayPal: ${config.paypalDemo ? 'DEMO simulator (no keys)' : 'SANDBOX'} | AI: ${config.aiDemo ? 'DEMO parser (no key)' : config.ai.geminiModel}`);
});
