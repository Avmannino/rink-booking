import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import ical from 'node-ical';
import crypto from 'crypto';
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

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' }) : null;
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// Allow raw body only for webhook route
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') return next();
  bodyParser.json()(req, res, next);
});

app.use(cors({ origin: CLIENT_ORIGIN }));

// Health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    hasStripe: Boolean(stripe),
    hasSupabase: Boolean(supabase),
    hasIcs: Boolean(ICS_URL)
  });
});

// Utility: deterministic slot id from start/end
function slotId(start, end) {
  return crypto.createHash('sha256')
    .update(`${start.toISOString()}__${end.toISOString()}`)
    .digest('hex')
    .slice(0, 24);
}

// GET /api/slots — parse ICS, filter out booked/held
app.get('/api/slots', async (_req, res) => {
  try {
    if (!ICS_URL) return res.status(500).json({ error: 'Missing AVAILABILITY_ICS_URL in .env' });

    const events = await ical.async.fromURL(ICS_URL);
    const now = new Date();

    const rawSlots = Object.values(events)
      .filter(e => e.type === 'VEVENT' && e.start && e.end && e.end > now)
      .map(e => {
        const start = new Date(e.start);
        const end = new Date(e.end);
        return { id: slotId(start, end), title: e.summary || 'Available Ice', start, end };
      });

    if (!supabase) return res.json(rawSlots); // if DB not set, just show ICS

    const { data: bookedRows } = await supabase.from('bookings').select('slot_id');
    const bookedSet = new Set((bookedRows || []).map(r => r.slot_id));

    const { data: holds } = await supabase
      .from('slot_holds')
      .select('slot_id, expires_at')
      .gt('expires_at', new Date().toISOString());

    const heldSet = new Set((holds || []).map(h => h.slot_id));

    const filtered = rawSlots.filter(s => !bookedSet.has(s.id) && !heldSet.has(s.id));
    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load slots' });
  }
});

// POST /api/create-checkout-session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' });
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { slotId: sid, start, end, name, email, purpose } = req.body || {};

    // Already booked?
    const { data: existing } = await supabase.from('bookings').select('slot_id').eq('slot_id', sid).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Slot already booked' });

    // Existing active hold?
    const { data: activeHold } = await supabase
      .from('slot_holds')
      .select('*')
      .eq('slot_id', sid)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (activeHold) return res.status(409).json({ error: 'Slot currently on hold' });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const amountCents = 40000; // TODO: set your price logic

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
              name: 'Private Ice Rental',
              description: `${purpose || 'Ice Time'} • ${new Date(start).toLocaleString()} – ${new Date(end).toLocaleTimeString()}`
            },
            unit_amount: amountCents
          },
          quantity: 1
        }
      ],
      metadata: { slot_id: sid, start, end, name, email, purpose: purpose || '' }
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

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe webhook
app.post('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verify failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sid = session.metadata?.slot_id;
    const start = session.metadata?.start;
    const end = session.metadata?.end;
    const name = session.metadata?.name;
    const email = session.metadata?.email;

    try {
      if (supabase) {
        const { data: existing } = await supabase.from('bookings').select('slot_id').eq('slot_id', sid).maybeSingle();
        if (!existing) {
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
        }
        await supabase.from('slot_holds').delete().eq('slot_id', sid);
      }
    } catch (dbErr) {
      console.error('DB error on webhook:', dbErr);
    }
  }

  res.json({ received: true });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
