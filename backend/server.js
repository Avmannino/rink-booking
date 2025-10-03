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
import nodemailer from 'nodemailer'; // <-- for SMTP email

const app = express();

// ---- ENV ----
const PORT = process.env.PORT || 8080;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const ICS_URL = process.env.AVAILABILITY_ICS_URL || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SUCCESS_URL = process.env.SUCCESS_URL || 'http://localhost:5173/success';
const CANCEL_URL = process.env.CANCEL_URL || 'http://localhost:5173/cancel';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

// Allow both localhost and 127.0.0.1 in dev
var allowedOrigins = new Set([
  CLIENT_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);
app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true);
    var ok = false;
    allowedOrigins.forEach(function (o) {
      if (o && origin.indexOf(o) === 0) ok = true;
    });
    if (ok) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  }
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

// weekend helper
function isWeekend(d) {
  var day = d.getDay(); // 0=Sun..6=Sat
  return day === 0 || day === 6;
}

// return hourly rate in USD cents for a given local Date
function rateCentsAt(date) {
  var h = date.getHours();
  var m = date.getMinutes();
  var t = h * 60 + m;
  var wknd = isWeekend(date);

  if (!wknd) {
    // Weekdays (Mon–Fri)
    // 5:35–6:35 = $250/hr
    if (t >= (5*60+35) && t < (6*60+35)) return 25000;
    // 6:35–15:45 = $495/hr
    if (t >= (6*60+35) && t < (15*60+45)) return 49500;
    // 15:45–21:45 = $945/hr
    if (t >= (15*60+45) && t < (21*60+45)) return 94500;
    // 21:45–22:45 = $495/hr
    if (t >= (21*60+45) && t < (22*60+45)) return 49500;
    return 0;
  }

  // Weekends (Sat–Sun)
  // 5:50–6:50 = $250/hr
  if (t >= (5*60+50) && t < (6*60+50)) return 25000;
  // 6:50–21:45 = $945/hr
  if (t >= (6*60+50) && t < (21*60+45)) return 94500;
  // 21:45–22:45 = $495/hr
  if (t >= (21*60+45) && t < (22*60+45)) return 49500;

  return 0;
}

// Price any interval [startISO, endISO) in integer cents, prorated per minute.
function priceIntervalCents(startISO, endISO) {
  var start = new Date(startISO);
  var end = new Date(endISO);
  if (!(start instanceof Date) || !(end instanceof Date) || isNaN(start) || isNaN(end) || end <= start) {
    return 0;
  }

  var total = 0;
  var cur = new Date(start);
  while (cur < end) {
    var next = new Date(cur.getTime() + 60 * 1000); // +1 minute
    var activeRate = rateCentsAt(cur);
    if (activeRate > 0) {
      total += Math.round(activeRate / 60); // per-minute cents
    }
    cur.setTime(next.getTime());
  }
  return total;
}

/* ==========================================
   Expand VEVENT into segments:
   - 60-minute blocks starting at event.start
   - plus a final remainder block if remainder >= 40 minutes
   - if total duration is 40–59 minutes, return a single block
   ========================================== */
function expandIntoSegments40(startDate, endDate) {
  var s = new Date(startDate);
  var e = new Date(endDate);
  var out = [];

  var totalMs = e - s;
  if (totalMs < 40 * 60 * 1000) {
    // shorter than 40 min => not offered
    return out;
  }

  var cur = new Date(s);
  var oneHourMs = 60 * 60 * 1000;

  while (cur < e) {
    var nxt = new Date(cur.getTime() + oneHourMs);
    if (nxt <= e) {
      // full 60-min chunk fits
      out.push({ start: new Date(cur), end: new Date(nxt) });
      cur = nxt;
    } else {
      // remainder
      var remMs = e - cur;
      if (remMs >= 40 * 60 * 1000) {
        out.push({ start: new Date(cur), end: new Date(e) });
      }
      break;
    }
  }

  return out;
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

// GET /api/slots — parse ICS, expand segments, filter by holds/bookings, include price_cents
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
      if (ev.end <= now) continue; // past

      var segs = expandIntoSegments40(ev.start, ev.end);
      for (var j = 0; j < segs.length; j++) {
        var b = segs[j];
        if (b.end <= now) continue;
        expanded.push({
          id: slotId(b.start, b.end),
          title: 'Available Ice',
          start: b.start,
          end: b.end,
          price_cents: priceIntervalCents(b.start, b.end) // ⬅️ prorated slot price
        });
      }
    }
    console.log('[SLOTS] segments (pre-DB filter): ' + expanded.length);

    if (!supabase) {
      console.log('[SLOTS] No Supabase configured; returning ' + expanded.length + ' slots. (' + (Date.now() - t0) + 'ms)');
      return res.json(expanded);
    }

    // Remove booked segments
    var bookedResp = await supabase.from('bookings').select('slot_id');
    if (bookedResp.error) console.error('[SLOTS] bookings error:', bookedResp.error.message);
    var bookedSet = new Set((bookedResp.data || []).map(function (r) { return r.slot_id; }));
    console.log('[SLOTS] Booked segment-ids: ' + bookedSet.size);

    // Remove active holds
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

// Create checkout — charge exact per-slot price (tiered, prorated)
app.post('/api/create-checkout-session', async function (req, res) {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' });
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    var body = req.body || {};
    var sid = body.slotId;
    var start = body.start;
    var end = body.end;
    var name = body.name;
    var email = body.email;
    var purpose = body.purpose;

    console.log('[CHECKOUT] Start', { sid: sid, start: start, end: end, email: email });

    // Already booked?
    var existing = await supabase.from('bookings').select('slot_id').eq('slot_id', sid).maybeSingle();
    if (existing && existing.data) {
      console.warn('[CHECKOUT] Slot already booked', sid);
      return res.status(409).json({ error: 'Slot already booked' });
    }

    // Active hold?
    var activeHold = await supabase
      .from('slot_holds')
      .select('*')
      .eq('slot_id', sid)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (activeHold && activeHold.data) {
      console.warn('[CHECKOUT] Slot currently on hold', sid);
      return res.status(409).json({ error: 'Slot currently on hold' });
    }

    var expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // PRICE: compute exact cents for this slot
    var amountCents = priceIntervalCents(start, end);
    if (amountCents <= 0) {
      return res.status(400).json({ error: 'Selected slot is not billable.' });
    }

    var session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      success_url: SUCCESS_URL + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: CANCEL_URL,
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Private Ice Rental',
              description: (purpose || 'Ice Time') + ' • ' +
                new Date(start).toLocaleString() + ' – ' + new Date(end).toLocaleTimeString()
            },
            unit_amount: amountCents
          },
          quantity: 1
        }
      ],
      metadata: { slot_id: sid, start: start, end: end, name: name, email: email, purpose: purpose || '' }
    });

    await supabase.from('slot_holds').insert({
      slot_id: sid,
      start_ts: new Date(start).toISOString(),
      end_ts: new Date(end).toISOString(),
      customer_name: name,
      customer_email: email,
      expires_at: expiresAt,
      checkout_session_id: session.id
    });

    console.log('[CHECKOUT] Session created', session.id);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[CHECKOUT] Error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe webhook
app.post('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async function (req, res) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.error('[WEBHOOK] Not configured: hasStripe?', !!stripe, 'hasSecret?', !!STRIPE_WEBHOOK_SECRET);
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  var sig = req.headers['stripe-signature'];
  var event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[WEBHOOK] Signature verify failed:', err && err.message ? err.message : err);
    return res.status(400).send('Webhook Error: ' + (err && err.message ? err.message : err));
  }

  console.log('[WEBHOOK] Event:', event && event.type ? event.type : '(no type)');

  if (event && event.type === 'checkout.session.completed') {
    var session = event.data.object;
    var md = (session && session.metadata) ? session.metadata : {};
    var sid = md.slot_id;
    var start = md.start;
    var end = md.end;
    var name = md.name;
    var email = md.email;

    try {
      if (supabase) {
        var existing = await supabase.from('bookings').select('slot_id').eq('slot_id', sid).maybeSingle();
        if (!(existing && existing.data)) {
          await supabase.from('bookings').insert({
            slot_id: sid,
            start_ts: new Date(start).toISOString(),
            end_ts: new Date(end).toISOString(),
            customer_name: name,
            customer_email: email,
            amount_cents: session.amount_total || 0,
            currency: session.currency || 'usd',
            stripe_payment_intent: session.payment_intent
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
        const amountText = fmtUSDFromCents(session.amount_total || 0);

        if (email) {
          const id1 = await sendBookingEmail({ to: email, whenText, amountText });
          console.log('[MAIL] Confirmation sent to', email, 'id:', id1);
        } else {
          console.warn('[MAIL] No customer email in session metadata.');
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
