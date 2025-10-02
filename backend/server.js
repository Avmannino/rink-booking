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
import { DateTime } from 'luxon';
import { createClient } from '@supabase/supabase-js';

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
const ARENA_TZ = process.env.ARENA_TZ || 'America/New_York';

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
    arenaTz: ARENA_TZ,
    icsHost: (() => { try { return ICS_URL ? new URL(ICS_URL).host : null; } catch { return null; } })()
  }, null, 2)
);

// Simple request logger
app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// Allow raw body only for webhook route
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') return next();
  bodyParser.json()(req, res, next);
});

// Allow both localhost and 127.0.0.1 in dev
const allowedOrigins = new Set([
  CLIENT_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if ([...allowedOrigins].some(o => o && origin.startsWith(o))) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  }
}));

// Root and health
app.get('/', (_req, res) => {
  res.type('text/plain').send('Rink Booking API is running. Try /health or /api/slots');
});
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    hasStripe: Boolean(stripe),
    hasSupabase: Boolean(supabase),
    hasIcs: Boolean(ICS_URL),
    arenaTz: ARENA_TZ
  });
});

// Utility: deterministic slot id from start/end
function slotId(start, end) {
  return crypto.createHash('sha256')
    .update(`${start.toISOString()}__${end.toISOString()}`)
    .digest('hex')
    .slice(0, 24);
}

// TZ-aware expansion: expand VEVENT into 1-hour blocks in ARENA_TZ (handles DST)
function expandIntoHoursZoned(startDate, endDate, zone) {
  let cur = DateTime.fromJSDate(new Date(startDate), { zone });
  const end = DateTime.fromJSDate(new Date(endDate), { zone });
  const blocks = [];
  while (cur < end) {
    const nxt = cur.plus({ hours: 1 });
    if (nxt > end) break; // only full 60-min blocks
    blocks.push({ start: cur, end: nxt });
    cur = nxt;
  }
  return blocks;
}

// GET /api/slots — parse ICS, expand to 1h blocks (ARENA_TZ), filter by holds/bookings
app.get('/api/slots', async (_req, res) => {
  const t0 = Date.now();
  try {
    if (!ICS_URL) {
      console.error('[SLOTS] Missing AVAILABILITY_ICS_URL in .env');
      return res.status(500).json({ error: 'Missing AVAILABILITY_ICS_URL in .env' });
    }

    console.log('[SLOTS] Fetching ICS…', new Date().toISOString());
    let events;
    try {
      events = await ical.async.fromURL(ICS_URL);
    } catch (e) {
      console.error('[SLOTS] ical.fromURL failed:', e?.message || e);
      return res.status(502).json({ error: 'Failed to fetch ICS. Use the Secret iCal address.' });
    }

    const now = DateTime.now().setZone(ARENA_TZ);
    const vevents = Object.values(events).filter(e => e?.type === 'VEVENT');
    console.log(`[SLOTS] ICS VEVENTs total: ${vevents.length}`);

    // Expand every future VEVENT into 1-hour sub-slots in arena TZ
    const expanded = [];
    for (const ev of vevents) {
      if (!ev.start || !ev.end) continue;
      const blocks = expandIntoHoursZoned(ev.start, ev.end, ARENA_TZ);
      for (const b of blocks) {
        if (b.end <= now) continue;
        expanded.push({
          id: slotId(b.start.toJSDate(), b.end.toJSDate()),
          title: '$600 / hr',
          // Send ISO strings WITH offset, so browser renders accurately
          start: b.start.toISO(), // e.g., 2025-10-10T12:30:00-04:00
          end: b.end.toISO()
        });
      }
    }
    console.log(`[SLOTS] 1h blocks (pre-DB filter): ${expanded.length}`);

    if (!supabase) {
      console.log(`[SLOTS] No Supabase configured; returning ${expanded.length} slots. (${Date.now() - t0}ms)`);
      return res.json(expanded);
    }

    // Remove booked hours
    const bookedResp = await supabase.from('bookings').select('slot_id');
    if (bookedResp.error) console.error('[SLOTS] bookings error:', bookedResp.error.message);
    const bookedSet = new Set((bookedResp.data || []).map(r => r.slot_id));
    console.log(`[SLOTS] Booked hour-ids: ${bookedSet.size}`);

    // Remove active holds on hours
    const holdsResp = await supabase
      .from('slot_holds')
      .select('slot_id, expires_at')
      .gt('expires_at', new Date().toISOString());
    if (holdsResp.error) console.error('[SLOTS] holds error:', holdsResp.error.message);
    const heldSet = new Set((holdsResp.data || []).map(h => h.slot_id));
    console.log(`[SLOTS] Active held hour-ids: ${heldSet.size}`);

    const filtered = expanded.filter(s => !bookedSet.has(s.id) && !heldSet.has(s.id));
    console.log(`[SLOTS] Final 1h slots: ${filtered.length}  — done in ${Date.now() - t0}ms`);

    res.json(filtered);
  } catch (err) {
    console.error('[SLOTS] Unexpected error:', err);
    res.status(500).json({ error: 'Failed to load slots' });
  }
});

// Optional: quick peek endpoint to verify ICS parsing & timezones
app.get('/debug/ics', async (_req, res) => {
  try {
    if (!ICS_URL) return res.status(500).json({ error: 'No AVAILABILITY_ICS_URL' });
    const events = await ical.async.fromURL(ICS_URL);
    const vevents = Object.values(events).filter(e => e?.type === 'VEVENT');
    const sample = vevents.slice(0, 5).map(e => ({
      summary: e.summary,
      start_raw: e.start,
      end_raw: e.end,
      start_eastern: DateTime.fromJSDate(new Date(e.start), { zone: ARENA_TZ }).toISO(),
      end_eastern: DateTime.fromJSDate(new Date(e.end), { zone: ARENA_TZ }).toISO()
    }));
    res.json({ count: vevents.length, arenaTz: ARENA_TZ, sample });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Failed to fetch ICS' });
  }
});

// Create checkout — $600/hr
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' });
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { slotId: sid, start, end, name, email, phone, purpose } = req.body || {};
    console.log('[CHECKOUT] Start', { sid, start, end, email });

    // Already booked?
    const existing = await supabase.from('bookings').select('slot_id').eq('slot_id', sid).maybeSingle();
    if (existing.data) {
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
    if (activeHold.data) {
      console.warn('[CHECKOUT] Slot currently on hold', sid);
      return res.status(409).json({ error: 'Slot currently on hold' });
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // PRICE: $600/hr
    const amountCents = 60000;

    const session = await stripe.checkout.sessions.create({
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
              description: `${purpose || 'Ice Time'} • ${new Date(start).toLocaleString()} – ${new Date(end).toLocaleTimeString()}`
            },
            unit_amount: amountCents
          },
          quantity: 1
        }
      ],
      metadata: { slot_id: sid, start, end, name, email, phone: phone || '', purpose: purpose || '' }
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
app.post('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.error('[WEBHOOK] Not configured: hasStripe?', !!stripe, 'hasSecret?', !!STRIPE_WEBHOOK_SECRET);
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[WEBHOOK] Signature verify failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('[WEBHOOK] Event:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sid = session.metadata?.slot_id;
    const start = session.metadata?.start;
    const end = session.metadata?.end;
    const name = session.metadata?.name;
    const email = session.metadata?.email;

    try {
      if (supabase) {
        const existing = await supabase.from('bookings').select('slot_id').eq('slot_id', sid).maybeSingle();
        if (!existing.data) {
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
    } catch (dbErr) {
      console.error('[WEBHOOK] DB error:', dbErr);
    }
  }

  res.json({ received: true });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
