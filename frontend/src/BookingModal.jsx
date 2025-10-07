import React, { useState } from 'react';

export default function BookingModal({ slot, onClose, onCheckout }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('Birthday Party');
  const [otherPurpose, setOtherPurpose] = useState('');   // shown when Purpose = Other
  const [groupSize, setGroupSize] = useState('');         // required

  const start = new Date(slot.start);
  const end = new Date(slot.end);

  // ----------------------------
  // Pricing helpers (match backend)
  // ----------------------------

  // Weekend helper
  function isWeekend(d) {
    const day = d.getDay(); // 0=Sun..6=Sat
    return day === 0 || day === 6;
  }

  // Return hourly rate (in *cents*) for a given local Date within your bands
  function rateCentsAt(date) {
    const h = date.getHours();
    const m = date.getMinutes();
    const mins = h * 60 + m;
    const wknd = isWeekend(date);

    if (!wknd) {
      // Weekdays (Mon–Fri)
      // 5:35–6:35 = $250/hr
      if (mins >= (5 * 60 + 35) && mins < (6 * 60 + 35)) return 25000;
      // 6:35–15:45 = $495/hr
      if (mins >= (6 * 60 + 35) && mins < (15 * 60 + 45)) return 49500;
      // 15:45–21:45 = $945/hr
      if (mins >= (15 * 60 + 45) && mins < (21 * 60 + 45)) return 94500;
      // 21:45–22:45 = $495/hr
      if (mins >= (21 * 60 + 45) && mins < (22 * 60 + 45)) return 49500;
      return 0;
    }

    // Weekends (Sat–Sun)
    // 5:50–6:50 = $250/hr
    if (mins >= (5 * 60 + 50) && mins < (6 * 60 + 50)) return 25000;
    // 6:50–21:45 = $945/hr
    if (mins >= (6 * 60 + 50) && mins < (21 * 60 + 45)) return 94500;
    // 21:45–22:45 = $495/hr
    if (mins >= (21 * 60 + 45) && mins < (22 * 60 + 45)) return 49500;

    return 0;
  }

  // Price any interval [start, end) by summing per-minute at the active rate
  function priceIntervalCents(startDate, endDate) {
    if (!(startDate instanceof Date) || !(endDate instanceof Date) || isNaN(startDate) || isNaN(endDate)) {
      return 0;
    }
    if (endDate <= startDate) return 0;

    let total = 0;
    const cur = new Date(startDate);
    while (cur < endDate) {
      const next = new Date(cur.getTime() + 60 * 1000); // +1 minute
      const activeRate = rateCentsAt(cur);
      if (activeRate > 0) {
        total += Math.round(activeRate / 60); // cents per minute
      }
      cur.setTime(next.getTime());
    }
    return total;
  }

  // Prefer server-computed price if provided; otherwise compute locally
  const priceCents =
    typeof slot.price_cents === 'number' ? slot.price_cents : priceIntervalCents(start, end);

  const fmtUSD = (cents) =>
    (cents / 100).toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });

  const normalizePhone = (value) => {
    let v = value.replace(/[^\d+]/g, '');
    if (/^\d{10}$/.test(v)) return `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}`;
    return value;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // If "Other" is selected, require non-empty custom purpose
    const finalPurpose = purpose === 'Other' ? otherPurpose.trim() : purpose;
    if (!finalPurpose) {
      // simple guard — browser will generally enforce required on the input too
      alert('Please enter your purpose.');
      return;
    }

    onCheckout({
      slotId: slot.id,
      start: start.toISOString(),
      end: end.toISOString(),
      name,
      email,
      phone,
      purpose: finalPurpose,
      groupSize: Number(groupSize),
    });
  };

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <h2 style={{ marginTop: 0, color: '#E6E8F0' }}>Ice Time Booking - Wings Arena</h2>

        <p style={{ marginTop: 0, marginBottom: 6, color: '#CBD5E1' }}>
          <strong>When:</strong> {start.toLocaleString()} – {end.toLocaleTimeString()}
        </p>
        <p style={{ marginTop: 0, marginBottom: 16, color: '#CBD5E1' }}>
          <strong>Price:</strong> {fmtUSD(priceCents)}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          <label style={styles.label}>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={styles.input}
              placeholder="Jane Doe"
            />
          </label>

          <label style={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={styles.input}
              placeholder="jane@example.com"
            />
          </label>

          <label style={styles.label}>
            Phone Number
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(normalizePhone(e.target.value))}
              pattern="[\d\s()+-]{7,}"
              title="Enter a valid phone number"
              required
              style={styles.input}
              placeholder="(555) 123-4567"
            />
          </label>

          {/* Purpose + conditional "Other" text box */}
          <label style={styles.label}>
            Purpose
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              style={styles.input}
            >
              <option>Birthday Party</option>
              <option>Private Event</option>
              <option>Team Practice</option>
              <option>Open Ice with Friends</option>
              <option>Other</option>
            </select>
          </label>

          {purpose === 'Other' && (
            <label style={styles.label}>
              Please describe your purpose
              <input
                value={otherPurpose}
                onChange={(e) => setOtherPurpose(e.target.value)}
                required
                style={styles.input}
                placeholder="Describe your event..."
              />
            </label>
          )}

          {/* REQUIRED: Estimated group/party size */}
          <label style={styles.label}>
            Estimated Group/Party Size
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={groupSize}
              onChange={(e) => setGroupSize(e.target.value)}
              required
              style={styles.input}
              placeholder="e.g., 12"
            />
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={styles.secondaryBtn}>Cancel</button>
            <button type="submit" style={styles.primaryBtn}>Proceed to Payment</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'grid', placeItems: 'center',
    padding: 16, zIndex: 9999
  },
  modal: {
    width: '100%', maxWidth: 520,
    background: '#0f172a',
    border: '1px solid #1f2a44',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 16px 32px rgba(0,0,0,0.45)'
  },
  label: { display: 'grid', gap: 6, fontSize: 14, color: '#E5E7EB' },
  input: {
    width: '95%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #334155',
    outline: 'none',
    background: '#0b1220',
    color: '#E5E7EB'
  },
  secondaryBtn: {
    appearance: 'none',
    border: 'none',
    borderRadius: 9999,
    padding: '10px 16px',
    fontWeight: 600,
    cursor: 'pointer',
    background: '#e5e7eb',
    color: '#111827'
  },
  primaryBtn: {
    appearance: 'none',
    border: 'none',
    borderRadius: 9999,
    padding: '10px 16px',
    fontWeight: 600,
    cursor: 'pointer',
    background: '#4f46e5',
    color: '#fff'
  }
};
