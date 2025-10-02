import React, { useState } from 'react';

export default function BookingModal({ slot, onClose, onCheckout }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('Birthday Party');

  const start = new Date(slot.start);
  const end = new Date(slot.end);

  // ---- Pricing ----
  const RATE_PER_HOUR = 600; // $600/hr
  const hours = Math.max(0, (end - start) / 3_600_000); // duration in hours
  const price = RATE_PER_HOUR * hours;

  const fmtUSD = (n) =>
    n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

  const normalizePhone = (value) => {
    let v = value.replace(/[^\d+]/g, '');
    if (/^\d{10}$/.test(v)) return `(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`;
    return value;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onCheckout({
      slotId: slot.id,
      start: start.toISOString(),
      end: end.toISOString(),
      name,
      email,
      phone,
      purpose,
    });
  };

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <h2 style={{ marginTop: 0 }}>Book Ice Time</h2>

        <p style={{ marginTop: 0, marginBottom: 6 }}>
          <strong>When:</strong> {start.toLocaleString()} – {end.toLocaleTimeString()}
        </p>
        <p style={{ marginTop: 0, marginBottom: 16 }}>
          <strong>Price:</strong> {fmtUSD(price)} {hours !== 1 ? `(${hours} hrs @ ${fmtUSD(RATE_PER_HOUR)}/hr)` : `(${fmtUSD(RATE_PER_HOUR)}/hr)`}
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
            </select>
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
    background: 'rgba(0,0,0,0.4)',
    display: 'grid', placeItems: 'center',
    padding: 16, zIndex: 9999
  },
  modal: {
    width: '100%', maxWidth: 520,
    background: '#040d33ff',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 8px 15px rgba(255, 255, 255, 0.25)'
  },
  label: { display: 'grid', gap: 6, fontSize: 14 },
  input: {
    width: '100%',
    padding: '10px 0px',
    borderRadius: 10,
    border: '1px solid #cbd5e1',
    outline: 'none'
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
