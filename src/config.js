require('dotenv').config();

const env = process.env;

const config = {
  port: Number(env.PORT) || 3000,
  paypal: {
    clientId: env.PAYPAL_CLIENT_ID || '',
    clientSecret: env.PAYPAL_CLIENT_SECRET || '',
    apiBase: env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com',
    invoicerEmail: env.PAYPAL_INVOICER_EMAIL || '',
    webhookId: env.PAYPAL_WEBHOOK_ID || '',
  },
  ai: {
    provider: (env.AI_PROVIDER || 'gemini').toLowerCase(),
    geminiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash',
    geminiFallbackModel: env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
  },
  maxInvoiceAmount: Number(env.MAX_INVOICE_AMOUNT) || 5000,
  maxPayoutAmount: Number(env.MAX_PAYOUT_AMOUNT) || 500,
  // Sandbox buyer used to pre-fill the guided demo (a test account, not a secret).
  demoBuyerEmail: env.DEMO_BUYER_EMAIL || '',
  dataFile: env.DATA_FILE || require('path').join(__dirname, '..', 'data', 'db.json'),
};

// PayPal demo mode: no sandbox keys -> a local in-memory PayPal simulator is used.
config.paypalDemo = !(config.paypal.clientId && config.paypal.clientSecret);
// AI demo mode: no Gemini key (or AI_PROVIDER=demo) -> keyless rule-based parser.
config.aiDemo = config.ai.provider === 'demo' || !config.ai.geminiKey;

if (!config.paypalDemo && !config.paypal.apiBase.includes('sandbox')) {
  throw new Error('DuePilot only runs against the PayPal SANDBOX. Set PAYPAL_API_BASE to the sandbox URL.');
}

module.exports = config;
