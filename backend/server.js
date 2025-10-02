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
import { Resend } from 'resend'; // <— NEW

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

// ---- Email ENV (Resend) ----
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';  // optional
const TZ = process.env.TIMEZONE || 'UTC';

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' }) : null;
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// Resend client
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ---- Startup diagnostics ----
console.log('[BOOT]',
  JSON.stringify({
    port: PORT,
    clientOrigin: CLIENT_ORIGIN,
    hasStripe: !!stripe,
    hasSupabase: !!supabase,
    hasIcsUrl: !!ICS_URL,
    hasResend: !!resend,
    fromEmail: FROM_EMAIL ? true : false,
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
    hasResend: Boolean(resend)
  });
});

// Utility: deterministic slot id from start/end
function slotId(start, end) {
  return crypto.createHash('sha256')
    .update(start.toISOString() + '__' + end.toISOString())
    .digest('hex')
    .slice(0, 24);
}

// Expand a VEVENT into 1-hour sub-intervals
function expandIntoHours(startDate, endDate) {
  var s = new Date(startDate);
  var e = new Date(endDate);
  var hours = [];
  var cur = new Date(s);
  while (cur < e) {
    var nxt = new Date(cur.getTime() + 60 * 60 * 1000);
    if (nxt > e) break; // only full 60-min blocks
    hours.push({ start: new Date(cur), end: new Date(nxt) });
    cur = nxt;
  }
  return hours;
}

// ---------- Email helpers ----------
function fmtDT(iso) {
  try {
    var d = new Date(iso);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(d);
  } catch (e) {
    return iso;
  }
}
function fmtUSD(cents) {
  try {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  } catch (e) {
    return '$' + (cents / 100).toFixed(2);
  }
}
function bookingEmailHTML(data) {
  var name = data.name || 'there';
  var email = data.email || '';
  var start = data.start || '';
  var end = data.end || '';
  var amount_cents = data.amount_cents || 0;
  var slot_id = data.slot_id || '';

  return (
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;">' +
      '<h2 style="margin:0 0 12px">Your Ice Time is Booked! 🧊⛸️</h2>' +
      '<p style="margin:0 0 10px">Hi ' + name + ',</p>' +
      '<p style="margin:0 0 10px">Thanks for booking with <strong>Wings Arena</strong>. Here are your details:</p>' +
      '<table style="border-collapse:collapse">' +
        '<tr><td style="padding:4px 8px;color:#555">Start</td><td style="padding:4px 8px"><strong>' + fmtDT(start) + '</strong></td></tr>' +
        '<tr><td style="padding:4px 8px;color:#555">End</td><td style="padding:4px 8px"><strong>' + fmtDT(end) + '</strong></td></tr>' +
        '<tr><td style="padding:4px 8px;color:#555">Price</td><td style="padding:4px 8px"><strong>' + fmtUSD(amount_cents) + '</strong></td></tr>' +
        '<tr><td style="padding:4px 8px;color:#555">Reference</td><td style="padding:4px 8px"><code>' + slot_id + '</code></td></tr>' +
      '</table>' +
      '<p style="margin:14px 0 0">If you need to make changes, reply to this email.</p>' +
      '<p style="margin:10px 0 0;color:#666;font-size:12px">Time zone: ' + TZ + '</p>' +
    '</div>'
  );
}
async function sendBookingEmails(payload) {
  if (!resend || !FROM_EMAIL) {
    console.warn('[EMAIL] Skipped (no RESEND_API_KEY or FROM_EMAIL).');
    return;
  }
  var html = bookingEmailHTML(payload);

  // Customer email
  await resend.emails.send({
    from: FROM_EMAIL,
    to: payload.email,
    subject: 'Wings Arena: Booking Confirmation',
    html: html
  });

  // Optional admin copy
  if (ADMIN_EMAIL) {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: 'New booking: ' + fmtDT(payload.start) + ' – ' + fmtDT(payload.end) + ' (' + payload.email + ')',
      html: html
    });
  }
}

// GET /api/slots — parse ICS, expand to 1h blocks, filter by holds/bookings
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

    // Expand every future VEVENT into 1-hour sub-slots
    var expanded = [];
    for (var i = 0; i < vevents.length; i++) {
      var ev = vevents[i];
      if (!ev.start || !ev.end) continue;
      if (ev.end <= now) continue; // past
      var blocks = expandIntoHours(ev.start, ev.end);
      for (var j = 0; j < blocks.length; j++) {
        var b = blocks[j];
        if (b.end <= now) continue;
        expanded.push({
          id: slotId(b.start, b.end),
          title: '$600 / hr',
          start: b.start,
          end: b.end
        });
      }
    }
    console.log('[SLOTS] 1h blocks (pre-DB filter): ' + expanded.length);

    if (!supabase) {
      console.log('[SLOTS] No Supabase configured; returning ' + expanded.length + ' slots. (' + (Date.now() - t0) + 'ms)');
      return res.json(expanded);
    }

    // Remove booked hours
    var bookedResp = await supabase.from('bookings').select('slot_id');
    if (bookedResp.error) console.error('[SLOTS] bookings error:', bookedResp.error.message);
    var bookedSet = new Set((bookedResp.data || []).map(function (r) { return r.slot_id; }));
    console.log('[SLOTS] Booked hour-ids: ' + bookedSet.size);

    // Remove active holds on hours
    var holdsResp = await supabase
      .from('slot_holds')
      .select('slot_id, expires_at')
      .gt('expires_at', new Date().toISOString());
    if (holdsResp.error) console.error('[SLOTS] holds error:', holdsResp.error.message);
    var heldSet = new Set((holdsResp.data || []).map(function (h) { return h.slot_id; }));
    console.log('[SLOTS] Active held hour-ids: ' + heldSet.size);

    var filtered = expanded.filter(function (s) { return !bookedSet.has(s.id) && !heldSet.has(s.id); });
    console.log('[SLOTS] Final 1h slots: ' + filtered.length + '  — done in ' + (Date.now() - t0) + 'ms');

    res.json(filtered);
  } catch (err) {
    console.error('[SLOTS] Unexpected error:', err);
    res.status(500).json({ error: 'Failed to load slots' });
  }
});

// Create checkout — $600/hr
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

    // PRICE: $600/hr
    var amountCents = 60000;

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
              name: 'Private Ice Rental — 1 hour',
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

      // ---- Send confirmation emails (customer + optional admin) ----
      try {
        await sendBookingEmails({
          name: name,
          email: email,
          start: start,
          end: end,
          amount_cents: session.amount_total || 0,
          slot_id: sid
        });
        console.log('[EMAIL] Sent to', email);
      } catch (e) {
        console.error('[EMAIL] Failed:', e);
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
