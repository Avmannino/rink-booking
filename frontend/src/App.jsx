import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import BookingModal from './BookingModal';



const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

export default function App() {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  const calendarEvents = useMemo(
    () =>
      events.map((s) => ({
        id: s.id,
        title: 'Available Ice',
        start: s.start,
        end: s.end,
      })),
    [events]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await axios.get(`${API_BASE}/api/slots`);
        setEvents(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleEventClick = (info) => {
    const slot = events.find((e) => e.id === info.event.id);
    if (slot) setSelected(slot);
  };

  return (
    <div style={{ maxWidth: 1100, margin: '40px auto', padding: 16 }}>
      <h1 style={{ textAlign: 'center', marginBottom: 12 }}>Wings Arena — Book Available Ice</h1>
      {loading && <p>Loading availability…</p>}
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay',
        }}
        allDaySlot={false}
        slotMinTime="06:00:00"
        slotMaxTime="24:00:00"
        events={calendarEvents}
        eventClick={handleEventClick}
        height="auto"
      />

      {selected && (
        <BookingModal
          slot={selected}
          onClose={() => setSelected(null)}
          onCheckout={async (payload) => {
            try {
              const res = await axios.post(`${API_BASE}/api/create-checkout-session`, payload);
              window.location.href = res.data.url; // Redirect to Stripe Checkout
            } catch (e) {
              alert(e.response?.data?.error || 'Failed to start checkout');
            }
          }}
        />
      )}
    </div>
  );
}
