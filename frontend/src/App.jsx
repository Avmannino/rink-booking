import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import BookingModal from './BookingModal';
import './calendar.css'; // ⬅️ ensures row heights come from our CSS, not inline styles

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';
const RATE_PER_HOUR = 600; // $600/hr

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
function fmtEndTime(date) {
  const s = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return s.replace(':00', '');
}
function fmtDate(d) {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtUSD(n) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
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

  // Centered label for ALL views: "8 AM - Available Ice (60 min)"
  const renderEventContent = (arg) => {
    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return null;

    const timeLabel = fmtStartTime(start);
    const durLabel = fmtDuration(end - start);
    const text = `${timeLabel} - Available Ice (${durLabel})`;

    return (
      <div style={styles.eventText}>
        {text}
      </div>
    );
  };

  // Hover tooltip (above + right of cursor)
  const handleMouseEnter = (arg) => {
    arg.el.style.cursor = 'pointer';

    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return;

    const hours = Math.max(0, (end - start) / 3_600_000);
    const price = RATE_PER_HOUR * hours;

    const tip = document.createElement('div');
    tip.className = 'slot-tooltip';
    tip.style.position = 'fixed';
    tip.style.zIndex = '99999';
    tip.style.pointerEvents = 'none';
    tip.style.background = '#ffffffef';
    tip.style.border = '1px solid #b01e2cff';
    tip.style.borderRadius = '8px';
    tip.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
    tip.style.padding = '10px 12px';
    tip.style.fontSize = '15px';
    tip.style.color = '#111827';
    tip.style.maxWidth = '290px';
    tip.style.lineHeight = '1.55';

    tip.innerHTML = `
      <div style="font-weight:700; margin-bottom:4px;">Available Ice</div>
      <div><strong>Date:</strong> ${fmtDate(start)}</div>
      <div><strong>Start:</strong> ${fmtStartTime(start)}</div>
      <div><strong>End:</strong> ${fmtEndTime(end)}</div>
      <div style="margin-top:6px;"><strong>Price:</strong> ${fmtUSD(price)}</div>
    `;

    document.body.appendChild(tip);

    const move = (e) => {
      const offsetX = 12, offsetY = 12;
      const rect = tip.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;

      // above + right default
      let x = e.clientX + offsetX;
      let y = e.clientY - rect.height - offsetY;

      if (y < 8) y = e.clientY + offsetY;                 // flip below if needed
      if (x + rect.width + 8 > vw) x = vw - rect.width - 8;
      if (y + rect.height + 8 > vh) y = vh - rect.height - 8;

      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    };

    document.addEventListener('mousemove', move);
    arg.el._slotTooltip = tip;
    arg.el._slotTooltipMove = move;
    if (arg.jsEvent) move(arg.jsEvent);
  };

  const handleMouseLeave = (arg) => {
    arg.el.style.cursor = '';
    if (arg.el._slotTooltip) {
      arg.el._slotTooltip.remove();
      delete arg.el._slotTooltip;
    }
    if (arg.el._slotTooltipMove) {
      document.removeEventListener('mousemove', arg.el._slotTooltipMove);
      delete arg.el._slotTooltipMove;
    }
  };

  return (
    <div style={{ maxWidth: 'auto', margin: '5px auto', padding: 30 }}>
      <h1 style={{ textAlign: 'center', marginBottom: 12 }}>
        Wings Arena — Book Available Ice
      </h1>
      {loading && <p>Loading availability…</p>}

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"      // ⬅️ time grid = vertical alignment by time
        timeZone="local"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay',
        }}
        allDaySlot={false}
        slotMinTime="07:00:00"
        slotMaxTime="22:00:00"

        /* 🔧 These three make time alignment clear & predictable */
        slotDuration="00:30:00"         // grid step
        slotLabelInterval="01:00"       // hour labels on the axis
        nowIndicator={true}             // red "now" line (optional)

        /* Overall space so taller rows have room */
        contentHeight={900}
        expandRows={true}

        events={calendarEvents}
        eventClick={handleEventClick}
        eventContent={renderEventContent}
        eventDidMount={(arg) => {
          // Style the actual event block; do NOT change vertical sizing/positioning.
          const el = arg.el;
          el.style.background = '#c6273fff'; // blue
          el.style.border = '1px solid #ffffffcf';
          el.style.color = '#fff';
          el.style.borderRadius = '10px';
          el.style.boxShadow = '0 3px 10px rgba(0,0,0,0.12)';
          el.style.cursor = 'pointer';

          // Make it visually narrower without affecting vertical placement:
          el.style.transform = 'scaleX(0.9)';     // width-only shrink
          el.style.transformOrigin = 'center';
          // IMPORTANT: do NOT set height/top/bottom here — FullCalendar controls that.
        }}
        eventMouseEnter={handleMouseEnter}
        eventMouseLeave={handleMouseLeave}
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
              window.location.href = res.data.url;
            } catch (e) {
              alert(e.response?.data?.error || 'Failed to start checkout');
            }
          }}
        />
      )}
    </div>
  );
}

const styles = {
  // Center the text inside the event block
  eventText: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '2px 6px',
    lineHeight: 1.8,
    whiteSpace: 'normal',
    fontSize: '16.2px',
    fontWeight: 400
  }
};
