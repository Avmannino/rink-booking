import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import BookingModal from './BookingModal';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

// Duration like "60 min", "90 min", "2h", "2h 30m"
function fmtDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${totalMin} min`;
}

// Start time like "8 AM", "8:30 AM" (drops :00 for top-of-hour)
function fmtStartTime(date) {
  const s = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return s.replace(':00', '');
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  // Map API -> FC events (ignore API title; we standardize label in eventContent)
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
        setEvents(Array.isArray(data) ? data : []);
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

  // Unified label for ALL views: "8 AM - Available Ice (60 min)"
  const renderEventContent = (arg) => {
    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return null;

    const timeLabel = fmtStartTime(start);
    const durLabel = fmtDuration(end - start);
    const text = `${timeLabel} - Available Ice (${durLabel})`;

    // Return a simple div. (You can style this via CSS if desired.)
    return <div>{text}</div>;
  };

  return (
    <div style={{ maxWidth: "auto", margin: '40px auto', padding: 16 }}>
      <h1 style={{ textAlign: 'center', marginBottom: 12 }}>
        Wings Arena — Book Available Ice
      </h1>
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
        slotMinTime="07:00:00"
        slotMaxTime="22:00:00"
        events={calendarEvents}
        eventClick={handleEventClick}
        eventContent={renderEventContent}   // <— same label for month/week/day
        height="auto"
      />

      {selected && (
        <BookingModal
          slot={selected}
          onClose={() => setSelected(null)}
          onCheckout={async (payload) => {
            try {
              const res = await axios.post(
                `${API_BASE}/api/create-checkout-session`,
                payload
              );
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
