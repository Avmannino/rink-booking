import React, { useState } from 'react';

export default function BookingModal({ slot, onClose, onCheckout }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('Birthday Party');
  const [otherPurpose, setOtherPurpose] = useState('');
  const [groupSize, setGroupSize] = useState('');

  const start = new Date(slot.start);
  const end = new Date(slot.end);

  // ---- Pricing helpers (match backend) ----
  function isWeekend(d) { const day = d.getDay(); return day === 0 || day === 6; }
  function rateCentsAt(date) {
    const h = date.getHours(), m = date.getMinutes(), mins = h * 60 + m, wknd = isWeekend(date);
    if (!wknd) {
      if (mins >= (5 * 60 + 35) && mins < (6 * 60 + 35)) return 25000;
      if (mins >= (6 * 60 + 35) && mins < (15 * 60 + 45)) return 49500;
      if (mins >= (15 * 60 + 45) && mins < (21 * 60 + 45)) return 94500;
      if (mins >= (21 * 60 + 45) && mins < (22 * 60 + 45)) return 49500;
      return 0;
    }
    if (mins >= (5 * 60 + 50) && mins < (6 * 60 + 50)) return 25000;
    if (mins >= (6 * 60 + 50) && mins < (21 * 60 + 45)) return 94500;
    if (mins >= (21 * 60 + 45) && mins < (22 * 60 + 45)) return 49500;
    return 0;
  }
  function priceIntervalCents(startDate, endDate) {
    if (!(startDate instanceof Date) || !(endDate instanceof Date) || isNaN(startDate) || isNaN(endDate)) return 0;
    if (endDate <= startDate) return 0;
    let total = 0;
    const cur = new Date(startDate);
    while (cur < endDate) {
      const next = new Date(cur.getTime() + 60 * 1000);
      const activeRate = rateCentsAt(cur);
      if (activeRate > 0) total += Math.round(activeRate / 60);
      cur.setTime(next.getTime());
    }
    return total;
  }
  const priceCents = typeof slot.price_cents === 'number' ? slot.price_cents : priceIntervalCents(start, end);
  const fmtUSD = (cents) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  const normalizePhone = (value) => { let v = value.replace(/[^\d+]/g, ''); if (/^\d{10}$/.test(v)) return `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}`; return value; };

  const handleSubmit = (e) => {
    e.preventDefault();
    const finalPurpose = purpose === 'Other' ? otherPurpose.trim() : purpose;
    if (!finalPurpose) { alert('Please enter your purpose.'); return; }
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

  // ---- Add-to-Calendar helpers ----
  const safeTitle = `Ice Time Reservation — Wings Arena`;
  const locationText = slot.location || 'Wings Arena';
  const detailsText =
    `Reserved ice slot at Wings Arena.\n` +
    `Purpose: ${purpose === 'Other' ? (otherPurpose || '—') : purpose}\n` +
    (name ? `Booked by: ${name}\n` : '') +
    `Estimated group size: ${groupSize || '—'}\n` +
    `Quoted price: ${fmtUSD(priceCents)}`;

  const toGoogleDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const toICSDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const buildGoogleCalendarUrl = () => {
    const dates = `${toGoogleDate(start)}/${toGoogleDate(end)}`; // UTC range
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: safeTitle,
      dates,
      details: detailsText,
      location: locationText,
      trp: 'true'
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  const downloadICS = () => {
    const uid = `${slot.id || 'slot'}-${start.getTime()}@wingsarena`;
    const ics =
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Wings Arena//Bookings//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${toICSDate(new Date())}
DTSTART:${toICSDate(start)}
DTEND:${toICSDate(end)}
SUMMARY:${safeTitle}
DESCRIPTION:${detailsText.replace(/\n/g, '\\n')}
LOCATION:${locationText}
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const y = start.getFullYear();
    const m = String(start.getMonth() + 1).padStart(2, '0');
    const d = String(start.getDate()).padStart(2, '0');
    a.href = url;
    a.download = `WingsArena_${y}${m}${d}_IceTime.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openGoogleCalendar = () => window.open(buildGoogleCalendarUrl(), '_blank', 'noopener,noreferrer');

  return (
    <div style={styles.backdrop} data-testid="booking-modal">
      <div style={styles.modal}>
        <h2 style={{ marginTop: 0, color: '#E6E8F0' }}>Ice Time Booking - Wings Arena</h2>

        <p style={{ marginTop: 0, marginBottom: 6, color: '#CBD5E1' }}>
          <strong>When:</strong> {start.toLocaleString()} – {end.toLocaleTimeString()}
        </p>
        <p style={{ marginTop: 0, marginBottom: 12, color: '#CBD5E1' }}>
          <strong>Price:</strong> {fmtUSD(priceCents)}
        </p>

        {/* ===== ADD TO CALENDAR (HIGH VISIBILITY) ===== */}
        <div style={styles.rule} />
        <div style={styles.addCalBlock} aria-label="Add to calendar">
          <div style={styles.addCalTitle}>Add this to your calendar</div>
          <div style={styles.addCalRow}>
            <button type="button" onClick={openGoogleCalendar} style={styles.addCalPrimary} data-testid="btn-google-cal">
              Google Calendar
            </button>
            <button type="button" onClick={downloadICS} style={styles.addCalSecondary} data-testid="btn-apple-ics">
              ⤓ iPhone
            </button>
          </div>
        </div>
        <div style={styles.rule} />

        {/* FORM */}
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <label style={styles.label}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required style={styles.input} placeholder="Jane Doe" />
          </label>
          <label style={styles.label}>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={styles.input} placeholder="jane@example.com" />
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
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} style={styles.input}>
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
              <input value={otherPurpose} onChange={(e) => setOtherPurpose(e.target.value)} required style={styles.input} placeholder="Describe your event..." />
            </label>
          )}

          <label style={styles.label}>
            Estimated Group/Party Size
            <input type="number" inputMode="numeric" min="1" step="1" value={groupSize} onChange={(e) => setGroupSize(e.target.value)} required style={styles.input} placeholder="e.g., 12" />
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
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 9999 },
  modal: { width: '100%', maxWidth: 520, background: '#0f172a', border: '1px solid #1f2a44', borderRadius: 12, padding: 20, boxShadow: '0 16px 32px rgba(0,0,0,0.45)' },
  rule: { height: 1, background: '#1f2a44', margin: '10px 0' },
  addCalBlock: { display: 'grid', gap: 8, marginBottom: 4 },
  addCalTitle: { color: '#93c5fd', fontWeight: 800, fontSize: 14, marginLeft: 165 },
  addCalRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  addCalPrimary: { marginLeft: 110, appearance: 'none', border: '1px solid #334155', borderRadius: 9999, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', background: 'hsla(142, 76%, 36%, 0.00)', color: '#fff' },
  addCalSecondary: { appearance: 'none', border: '1px solid #334155', borderRadius: 9999, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', background: '#0b1220', color: '#e5e7eb' },
  label: { display: 'grid', gap: 6, fontSize: 14, color: '#E5E7EB' },
  input: { width: '95%', padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', outline: 'none', background: '#0b1220', color: '#E5E7EB' },
  secondaryBtn: { appearance: 'none', border: 'none', borderRadius: 9999, padding: '10px 16px', fontWeight: 600, cursor: 'pointer', background: '#e5e7eb', color: '#111827' },
  primaryBtn: { appearance: 'none', border: 'none', borderRadius: 9999, padding: '10px 16px', fontWeight: 600, cursor: 'pointer', background: '#4f46e5', color: '#fff' }
};
