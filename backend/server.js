// ---- Load .env from backend/.env OR fallback to ../.env (project root) ----
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendEnv = path.join(__dirname, '.env');
const rootEnv = path.join(__dirname, '../.env');

if (fs.existsSync(backendEnv)) {
  dotenv.config({ path: backendEnv });
  console.log('[ENV] Loaded backend/.env');
} else if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
  console.log('[ENV] Loaded ../.env (project root)');
} else {
  console.warn('[ENV] No .env found at', backendEnv, 'or', rootEnv);
}

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import ical from 'node-ical';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

// --- security & validation ---
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

const app = express();

// ---- ENV ----
const PORT = process.env.PORT || 8080;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const ICS_URL = process.env.AVAILABILITY_ICS_URL || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
// Note: SUCCESS_URL may be a full URL or a path like `${CLIENT_ORIGIN}/success`
const SUCCESS_URL = process.env.SUCCESS_URL || `${CLIENT_ORIGIN}/success`;
const CANCEL_URL = process.env.CANCEL_URL || `${CLIENT_ORIGIN}/`;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PII_ENC_KEY = process.env.PII_ENC_KEY || '';

// mail settings
const MAIL_PROVIDER = (process.env.MAIL_PROVIDER || '').toLowerCase(); // 'smtp' | 'resend'
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const TIMEZONE = process.env.TIMEZONE || undefined; // optional

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' }) : null;
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// ---- Startup diagnostics ----
console.log('[BOOT]',
  JSON.stringify({
    port: PORT,
    clientOrigin: CLIENT_ORIGIN,
    hasStripe: !!stripe,
    hasSupabase: !!supabase,
    hasIcsUrl: !!ICS_URL,
    hasMailConfig: Boolean((MAIL_PROVIDER === 'smtp' && SMTP_USER && FROM_EMAIL) || (RESEND_API_KEY && FROM_EMAIL)),
    mailProvider: MAIL_PROVIDER || (RESEND_API_KEY ? 'resend' : '(none)'),
    icsHost: (function () { try { return ICS_URL ? new URL(ICS_URL).host : null; } catch (e) { return null; } })()
  }, null, 2)
);

// ===== Utility: build success_url with confirm + session_id =====
// IMPORTANT: build this as a raw string so {CHECKOUT_SESSION_ID} is NOT URL-encoded.
function buildSuccessUrl() {
  const base = SUCCESS_URL.startsWith('http')
    ? SUCCESS_URL
    : `${CLIENT_ORIGIN}/${SUCCESS_URL.replace(/^\//, '')}`;
  const sep = base.includes('?') ? '&' : '?';
  // Do NOT encode braces – Stripe replaces this literal token server-side.
  return `${base}${sep}confirm=1&session_id={CHECKOUT_SESSION_ID}`;
}

// ===== Security middleware =====
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Simple request logger
app.use(function (req, _res, next) {
  console.log('[HTTP] ' + req.method + ' ' + req.url);
  next();
});

// Allow raw body only for webhook route
app.use(function (req, res, next) {
  if (req.originalUrl === '/api/stripe/webhook') return next();
  bodyParser.json()(req, res, next);
});

// Rate limits
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300
});
app.use('/api/stripe/webhook', webhookLimiter);

// CORS (exact origins only)
const allowedOrigins = new Set([
  CLIENT_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
  credentials: false
}));

// Root and health
app.get('/', function (_req, res) {
  res.type('text/plain').send('Rink Booking API is running. Try /health or /api/slots');
});
app.get('/health', function (_req, res) {
  res.json({
    ok: true,
    hasStripe: Boolean(stripe),
    hasSupabase: Boolean(supabase),
    hasIcs: Boolean(ICS_URL),
    mailProvider: MAIL_PROVIDER || (RESEND_API_KEY ? 'resend' : null),
    hasFromEmail: Boolean(FROM_EMAIL)
  });
});

// Utility: deterministic slot id from start/end
function slotId(start, end) {
  return crypto.createHash('sha256')
    .update(start.toISOString() + '__' + end.toISOString())
    .digest('hex')
    .slice(0, 24);
}

/* =========================
   PRICING (tiered + prorated)
   ========================= */

function isWeekend(d) {
  var day = d.getDay(); // 0=Sun..6=Sat
  return day === 0 || day === 6;
}

function rateCentsAt(date) {
  var h = date.getHours();
  var m = date.getMinutes();
  var t = h * 60 + m;
  var wknd = isWeekend(date);

  if (!wknd) {
    if (t >= (5 * 60 + 35) && t < (6 * 60 + 35)) return 25000;
    if (t >= (6 * 60 + 35) && t < (15 * 60 + 45)) return 49500;
    if (t >= (15 * 60 + 45) && t < (21 * 60 + 45)) return 94500;
    if (t >= (21 * 60 + 45) && t < (22 * 60 + 45)) return 49500;
    return 0;
  }
  if (t >= (5 * 60 + 50) && t < (6 * 60 + 50)) return 25000;
  if (t >= (6 * 60 + 50) && t < (21 * 60 + 45)) return 94500;
  if (t >= (21 * 60 + 45) && t < (22 * 60 + 45)) return 49500;
  return 0;
}

function priceIntervalCents(startISO, endISO) {
  var start = new Date(startISO);
  var end = new Date(endISO);
  if (!(start instanceof Date) || !(end instanceof Date) || isNaN(start) || isNaN(end) || end <= start) {
    return 0;
  }
  var total = 0;
  var cur = new Date(start);
  while (cur < end) {
    var next = new Date(cur.getTime() + 60 * 1000);
    var activeRate = rateCentsAt(cur);
    if (activeRate > 0) {
      total += Math.round(activeRate / 60);
    }
    cur.setTime(next.getTime());
  }
  return total;
}

/* ==========================================
   Expand VEVENT into segments (>=40 minutes)
   ========================================== */
function expandIntoSegments40(startDate, endDate) {
  var s = new Date(startDate);
  var e = new Date(endDate);
  var out = [];
  var totalMs = e - s;
  if (totalMs < 40 * 60 * 1000) return out;

  var cur = new Date(s);
  var oneHourMs = 60 * 60 * 1000;

  while (cur < e) {
    var nxt = new Date(cur.getTime() + oneHourMs);
    if (nxt <= e) {
      out.push({ start: new Date(cur), end: new Date(nxt) });
      cur = nxt;
    } else {
      var remMs = e - cur;
      if (remMs >= 40 * 60 * 1000) out.push({ start: new Date(cur), end: new Date(e) });
      break;
    }
  }
  return out;
}

/* ============
   AES-GCM PII
   ============ */
function getKey() {
  const raw = (PII_ENC_KEY || '').trim();
  if (!raw.startsWith('base64:')) throw new Error('PII_ENC_KEY must start with base64:');
  const buf = Buffer.from(raw.slice(7), 'base64');
  if (buf.length !== 32) throw new Error('PII_ENC_KEY must decode to 32 bytes');
  return buf;
}
function encPII(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64'); // iv|tag|cipher
}

/* =================
   Email helpers
   ================= */
function fmtUSDFromCents(cents) {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}
function fmtWhen(startISO, endISO) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const dt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE || undefined
  });
  const tOnly = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE || undefined
  });
  return `${dt.format(start)} – ${tOnly.format(end)}`;
}

// Send booking email via SMTP (nodemailer) or Resend (if configured)
async function sendBookingEmail({ to, whenText, amountText }) {
  if (!FROM_EMAIL) throw new Error('FROM_EMAIL is not set');

  if (MAIL_PROVIDER === 'smtp' && SMTP_USER && SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    const info = await transporter.sendMail({
      from: FROM_EMAIL,
      to,
      subject: 'Wings Arena — Booking Confirmation',
      text: `Thank you! Your ice time is booked.\n\nWhen: ${whenText}\nAmount: ${amountText}\n\nSee you at the rink!`,
      html: `<p>Thank you! Your ice time is booked.</p>
             <p><b>When:</b> ${whenText}<br/><b>Amount:</b> ${amountText}</p>
             <p>Questions? Give us a shout at info@wingsarena.com | 203-357-1055</p>`
    });
    return info.messageId || 'smtp:ok';
  }

  if (RESEND_API_KEY) {
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: 'Wings Arena — Booking Confirmation',
      html: `<p>Thank you! Your ice time is booked.</p>
             <p><b>When:</b> ${whenText}<br/><b>Amount:</b> ${amountText}</p>
             <p>See you at the rink!</p>`
    });
    if (error) throw error;
    return data?.id || 'resend:ok';
  }

  throw new Error('No mail provider configured');
}

// GET /api/slots
app.get('/api/slots', async function (_req, res) {
  var t0 = Date.now();
  try {
    if (!ICS_URL) {
      console.error('[SLOTS] Missing AVAILABILITY_ICS_URL in .env');
      return res.status(500).json({ error: 'Missing AVAILABILITY_ICS_URL in .env' });
    }

    console.log('[SLOTS] Fetching ICS…', new Date().toISOString());
    var events;
    try {
      events = await ical.async.fromURL(ICS_URL);
    } catch (e) {
      console.error('[SLOTS] ical.fromURL failed:', (e && e.message) ? e.message : e);
      return res.status(502).json({ error: 'Failed to fetch ICS. Use the Secret iCal address.' });
    }

    var now = new Date();
    var vevents = Object.values(events).filter(function (ev) {
      return ev && ev.type === 'VEVENT';
    });
    console.log('[SLOTS] ICS VEVENTs total: ' + vevents.length);

    var expanded = [];
    for (var i = 0; i < vevents.length; i++) {
      var ev = vevents[i];
      if (!ev.start || !ev.end) continue;
      if (ev.end <= now) continue;

      var segs = expandIntoSegments40(ev.start, ev.end);
      for (var j = 0; j < segs.length; j++) {
        var b = segs[j];
        if (b.end <= now) continue;
        expanded.push({
          id: slotId(b.start, b.end),
          title: 'Available Ice',
          start: b.start,
          end: b.end,
          price_cents: priceIntervalCents(b.start, b.end)
        });
      }
    }
    console.log('[SLOTS] segments (pre-DB filter): ' + expanded.length);

    if (!supabase) {
      console.log('[SLOTS] No Supabase configured; returning ' + expanded.length + ' slots. (' + (Date.now() - t0) + 'ms)');
      return res.json(expanded);
    }

    var bookedResp = await supabase.from('bookings').select('slot_id');
    if (bookedResp.error) console.error('[SLOTS] bookings error:', bookedResp.error.message);
    var bookedSet = new Set((bookedResp.data || []).map(function (r) { return r.slot_id; }));
    console.log('[SLOTS] Booked segment-ids: ' + bookedSet.size);

    var holdsResp = await supabase
      .from('slot_holds')
      .select('slot_id, expires_at')
      .gt('expires_at', new Date().toISOString());
    if (holdsResp.error) console.error('[SLOTS] holds error:', holdsResp.error.message);
    var heldSet = new Set((holdsResp.data || []).map(function (h) { return h.slot_id; }));
    console.log('[SLOTS] Active held segment-ids: ' + heldSet.size);

    var filtered = expanded.filter(function (s) { return !bookedSet.has(s.id) && !heldSet.has(s.id); });
    console.log('[SLOTS] Final segments: ' + filtered.length + '  — done in ' + (Date.now() - t0) + 'ms');

    res.json(filtered);
  } catch (err) {
    console.error('[SLOTS] Unexpected error:', err);
    res.status(500).json({ error: 'Failed to load slots' });
  }
});

// ===== Validation schema for checkout
const CreateCheckoutSchema = z.object({
  slotId: z.string().min(6),
  start: z.string().datetime(),
  end: z.string().datetime(),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  purpose: z.string().max(200).optional()
});

// Create checkout — charge exact per-slot price (tiered, prorated)
app.post('/api/create-checkout-session', async function (req, res) {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' });
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const parse = CreateCheckoutSchema.safeParse(req.body || {});
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parse.error.flatten() });
    }

    const { slotId: sid, start, end, name, email, purpose } = parse.data;
    console.log('[CHECKOUT] Start', { sid, start, end, email });

    // Already booked?
    const existing = await supabase.from('bookings').select('slot_id').eq('slot_id', sid).maybeSingle();
    if (existing && existing.data) {
      console.warn('[CHECKOUT] Slot already booked', sid);
      return res.status(409).json({ error: 'Slot already booked' });
    }

    // Active hold?
    const activeHold = await supabase
      .from('slot_holds')
      .select('*')
      .eq('slot_id', sid)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (activeHold && activeHold.data) {
      console.warn('[CHECKOUT] Slot currently on hold', sid);
      return res.status(409).json({ error: 'Slot currently on hold' });
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // PRICE: compute exact cents for this slot
    const amountCents = priceIntervalCents(start, end);
    if (amountCents <= 0) {
      return res.status(400).json({ error: 'Selected slot is not billable.' });
    }

    // Description made deterministic (ISO strings) to avoid subtle variations
    const description =
      (purpose || 'Ice Time') +
      ' • ' +
      new Date(start).toISOString() +
      ' – ' +
      new Date(end).toISOString();

    // Build success URL with confirm flag & session_id placeholder (NOT encoded)
    const successUrl = buildSuccessUrl();

    // Create the Stripe Checkout Session (no custom idempotency key to avoid 400s)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      success_url: successUrl,
      cancel_url: CANCEL_URL,
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Private Ice Rental', description },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      metadata: { slot_id: sid, start, end, name, email, purpose: purpose || '' }
    });

    // Record a hold so the slot can't be double-booked during checkout
    await supabase.from('slot_holds').insert({
      slot_id: sid,
      start_ts: new Date(start).toISOString(),
      end_ts: new Date(end).toISOString(),
      customer_name: encPII(name),
      customer_email: encPII(email),
      expires_at: expiresAt,
      checkout_session_id: session.id
    });

    console.log('[CHECKOUT] Session created', session.id, 'success_url:', successUrl);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[CHECKOUT] Error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ---- TEMP: SMTP test route (remove after testing) ----
app.post('/api/dev/test-email', async (req, res) => {
  try {
    const whenText = 'Thu Oct 24, 7:00 PM – 8:00 PM';
    const amountText = '$100.00';
    const to = ADMIN_EMAIL || SMTP_USER;
    const id = await sendBookingEmail({ to, whenText, amountText });
    console.log('[MAIL] Test email sent to', to, 'id:', id);
    res.json({ ok: true, to, id });
  } catch (e) {
    console.error('[MAIL] Test send failed:', e?.message || e);
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ---- Fallback confirmation endpoint (call from success page with session_id) ----
app.post('/api/checkout/confirm', bodyParser.json(), async (req, res) => {
  try {
    const { session_id } = req.body || {};
    if (!stripe || !session_id) return res.status(400).json({ error: 'Missing session_id' });

    const verifiedSession = await stripe.checkout.sessions.retrieve(session_id, { expand: ['payment_intent'] });
    const md = verifiedSession.metadata || {};
    const sid = md.slot_id;
    const start = md.start;
    const end = md.end;
    const name = md.name;
    const email =
      verifiedSession.customer_details?.email ||
      verifiedSession.customer_email ||
      md.email || null;
    console.log('[CONFIRM] Email resolved:', email);

    const amountTotal = verifiedSession.amount_total || 0;
    const currency = verifiedSession.currency || 'usd';
    const paymentIntentId = typeof verifiedSession.payment_intent === 'object'
      ? verifiedSession.payment_intent.id
      : verifiedSession.payment_intent;

    if (supabase) {
      const existing = await supabase.from('bookings').select('slot_id').eq('slot_id', sid).maybeSingle();
      if (!(existing && existing.data)) {
        await supabase.from('bookings').insert({
          slot_id: sid,
          start_ts: new Date(start).toISOString(),
          end_ts: new Date(end).toISOString(),
          customer_name: encPII(name),
          customer_email: encPII(email),
          amount_cents: amountTotal,
          currency,
          stripe_payment_intent: paymentIntentId
        });
      }
      await supabase.from('slot_holds').delete().eq('slot_id', sid);
    }

    // Safeguard: never fail the confirmation just because email isn't configured
    const canSendMail =
      FROM_EMAIL &&
      (
        (MAIL_PROVIDER === 'smtp' && SMTP_USER && SMTP_PASS) ||
        RESEND_API_KEY
      );

    const whenText = fmtWhen(start, end);
    const amountText = fmtUSDFromCents(amountTotal);

    if (canSendMail) {
      try {
        if (email) await sendBookingEmail({ to: email, whenText, amountText });
        if (ADMIN_EMAIL) await sendBookingEmail({ to: ADMIN_EMAIL, whenText, amountText });
      } catch (mailErr) {
        console.error('[CONFIRM] Email send failed:', mailErr?.message || mailErr);
        // swallow email errors
      }
    } else {
      console.warn('[CONFIRM] Mail not configured; skipping confirmation emails.');
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[CONFIRM] Error:', e?.message || e);
    return res.status(500).json({ error: 'Failed to confirm session' });
  }
});

// ---- Optional: passthrough /success -> root with confirm flag ----
// If your SUCCESS_URL still points to /success, this ensures the frontend sees ?confirm=1.
app.get('/success', (req, res) => {
  try {
    const sessionId = req.query.session_id || '';
    const redirectStatus = req.query.redirect_status;
    const u = new URL(`${CLIENT_ORIGIN}/`);
    u.searchParams.set('confirm', '1');
    if (sessionId) u.searchParams.set('session_id', sessionId);
    if (redirectStatus) u.searchParams.set('redirect_status', redirectStatus);
    return res.redirect(302, u.toString());
  } catch (e) {
    console.warn('[SUCCESS passthrough] Failed to redirect:', e?.message || e);
    return res.redirect(302, `${CLIENT_ORIGIN}/?confirm=1`);
  }
});

// Stripe webhook
app.post('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async function (req, res) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.error('[WEBHOOK] Not configured: hasStripe?', !!stripe, 'hasSecret?', !!STRIPE_WEBHOOK_SECRET);
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  console.log('[WEBHOOK] Hit', new Date().toISOString());

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[WEBHOOK] Signature verify failed:', err && err.message ? err.message : err);
    return res.status(400).send('Webhook Error: ' + (err && err.message ? err.message : err));
  }

  console.log('[WEBHOOK] Event:', event && event.type ? event.type : '(no type)');

  if (event && event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Fetch the full session from Stripe to verify details
    let verifiedSession;
    try {
      verifiedSession = await stripe.checkout.sessions.retrieve(session.id, { expand: ['payment_intent'] });
    } catch (e) {
      console.error('[WEBHOOK] Failed to retrieve session from Stripe:', e?.message || e);
      return res.status(400).send('Unable to verify session.');
    }

    const md = verifiedSession.metadata || {};
    const sid = md.slot_id;
    const start = md.start;
    const end = md.end;
    const name = md.name;
    const email =
      verifiedSession.customer_details?.email ||
      verifiedSession.customer_email ||
      md.email || null;
    console.log('[WEBHOOK] Email resolved:', email);

    const amountTotal = verifiedSession.amount_total || 0;
    const currency = verifiedSession.currency || 'usd';
    const paymentIntentId = typeof verifiedSession.payment_intent === 'object'
      ? verifiedSession.payment_intent.id
      : verifiedSession.payment_intent;

    try {
      if (supabase) {
        const existing = await supabase.from('bookings').select('slot_id').eq('slot_id', sid).maybeSingle();
        if (!(existing && existing.data)) {
          await supabase.from('bookings').insert({
            slot_id: sid,
            start_ts: new Date(start).toISOString(),
            end_ts: new Date(end).toISOString(),
            customer_name: encPII(name),
            customer_email: encPII(email),
            amount_cents: amountTotal,
            currency,
            stripe_payment_intent: paymentIntentId
          });
          console.log('[WEBHOOK] Booking inserted for', sid);
        } else {
          console.log('[WEBHOOK] Booking already exists for', sid);
        }
        await supabase.from('slot_holds').delete().eq('slot_id', sid);
        console.log('[WEBHOOK] Hold cleared for', sid);
      }

      // ---- Send confirmation emails ----
      try {
        const whenText = fmtWhen(start, end);
        const amountText = fmtUSDFromCents(amountTotal);

        if (email) {
          const id1 = await sendBookingEmail({ to: email, whenText, amountText });
          console.log('[MAIL] Confirmation sent to', email, 'id:', id1);
        } else {
          console.warn('[MAIL] No customer email on session.');
        }

        if (ADMIN_EMAIL) {
          const id2 = await sendBookingEmail({ to: ADMIN_EMAIL, whenText, amountText });
          console.log('[MAIL] Admin copy sent to', ADMIN_EMAIL, 'id:', id2);
        }
      } catch (mailErr) {
        console.error('[MAIL] Failed to send confirmation:', mailErr?.message || mailErr);
      }
    } catch (dbErr) {
      console.error('[WEBHOOK] DB error:', dbErr);
    }
  }

  res.json({ received: true });
});

app.listen(PORT, function () {
  console.log('API listening on http://localhost:' + PORT);
});
