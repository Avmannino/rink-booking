import React, { useState } from 'react';

export default function BookingModal({ slot, onClose, onCheckout }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [purpose, setPurpose] = useState('Birthday Party');

  const start = new Date(slot.start);
  const end = new Date(slot.end);

  const handleSubmit = (e) => {
    e.preventDefault();
    onCheckout({
      slotId: slot.id,
      start: start.toISOString(),
      end: end.toISOString(),
      name,
      email,
      purpose,
    });
  };

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <h2>Book Ice Time</h2>
        <p>
          <strong>When:</strong> {start.toLocaleString()} – {end.toLocaleTimeString()}
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          <label style={styles.label}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required style={styles.input} />
          </label>
          <label style={styles.label}>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={styles.input} />
          </label>
          <label style={styles.label}>
            Purpose
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} style={styles.input}>
              <option>Birthday Party</option>
              <option>Private Event</option>
              <option>Team Practice</option>
              <option>Open Ice with Friends</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit">Proceed to Payment</button>
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
    background: '#942525ff',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 12px 40px rgba(0,0,0,0.25)'
  },
  label: { display: 'grid', gap: 6, fontSize: 14 },
  input: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc' }
};
