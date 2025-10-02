import React, { useEffect, useState, useMemo, useRef } from 'react';
import axios from 'axios';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import BookingModal from './BookingModal';
import './calendar.css'; // row heights / month cell height

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

  const [calTitle, setCalTitle] = useState('');
  const [currentView, setCurrentView] = useState('timeGridWeek');

  const calendarRef = useRef(null);

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
    tip.style.border = '1px solid #b01e2c';
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

  // Calendar API helpers
  const getApi = () => calendarRef.current?.getApi();
  const goPrev = () => getApi()?.prev();
  const goNext = () => getApi()?.next();
  const goToday = () => getApi()?.today();
  const switchView = (viewName) => {
    setCurrentView(viewName);
    getApi()?.changeView(viewName);
  };

  return (
    <div style={{ maxWidth: 'auto', margin: '5px auto', paddingLeft: 0, paddingRight: 0, width: '95%' }}>
      <h1 style={{ textAlign: 'center', marginBottom: 15 }}>
        Wings Arena — Book Available Ice
      </h1>

      {/* Custom header BAR (Today left, Title center, View buttons right) */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <button type="button" onClick={goToday} style={styles.topBtn}>Today</button>
        </div>
        <div style={styles.topBarCenter}>
          <div style={styles.headerTitle}>{calTitle || '\u00A0'}</div>
        </div>
        <div style={styles.topBarRight}>
          <button
            type="button"
            onClick={() => switchView('dayGridMonth')}
            style={{ ...styles.viewBtn, ...(currentView === 'dayGridMonth' ? styles.viewBtnActive : {}) }}
          >
            Month
          </button>
          <button
            type="button"
            onClick={() => switchView('timeGridWeek')}
            style={{ ...styles.viewBtn, ...(currentView === 'timeGridWeek' ? styles.viewBtnActive : {}) }}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => switchView('timeGridDay')}
            style={{ ...styles.viewBtn, ...(currentView === 'timeGridDay' ? styles.viewBtnActive : {}) }}
          >
            Day
          </button>
        </div>
      </div>

      {/* Centered Prev / Next directly UNDER the title */}
      <div style={styles.navRow}>
        <button type="button" onClick={goPrev} style={styles.navBtn} aria-label="Previous period">‹</button>
        <button type="button" onClick={goNext} style={styles.navBtn} aria-label="Next period">›</button>
      </div>

      {loading && <p>Loading availability…</p>}

      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        headerToolbar={false}            // we’re using our own header
        initialView={currentView}
        timeZone="local"
        allDaySlot={false}
        slotMinTime="06:00:00"
        slotMaxTime="22:00:00"

        /* time alignment */
        slotDuration="00:30:00"
        slotLabelInterval="01:00"
        nowIndicator={true}

        /* space for taller rows */
        contentHeight={900}
        expandRows={true}

        events={calendarEvents}
        eventClick={handleEventClick}
        eventContent={renderEventContent}
        eventDidMount={(arg) => {
          // Style the actual event block; do NOT change vertical sizing/positioning.
          const el = arg.el;
          el.style.background = '#c6273f';
          el.style.border = '1px solid #ffffffcf';
          el.style.color = '#fff';
          el.style.borderRadius = '10px';
          el.style.boxShadow = '0 3px 10px rgba(0,0,0,0.12)';
          el.style.cursor = 'pointer';

          // Make it visually narrower without affecting vertical placement:
          el.style.transform = 'scaleX(0.9)';
          el.style.transformOrigin = 'center';
        }}
        eventMouseEnter={handleMouseEnter}
        eventMouseLeave={handleMouseLeave}
        datesSet={(info) => {
          // Update our custom title whenever the calendar navigates or view changes
          setCalTitle(info.view.title);
          setCurrentView(info.view.type);
        }}
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
  // Header row: Today (left), Title (center), View buttons (right)
  topBar: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4
  },
  topBarLeft: {
    display: 'flex',
    justifyContent: 'flex-start',
    position: 'relative',
    top: '5vh'
  },
  topBarCenter: {
    display: 'flex',
    justifyContent: 'center'
  },
  topBarRight: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 18,
    position: 'relative',
    top: '5vh'
  },
  headerTitle: {
    fontSize: '1.8rem',
    fontWeight: 700,
    lineHeight: 2.5
  },
  topBtn: {
    minWidth: 95,
    height: 45,
    borderRadius: 8,
    border: '2px solid rgba(0,0,0,0.15)',
    background: '#131348ff',
    color: '#ffffffff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer'
  },

  // Prev/Next row centered under the title
  navRow: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10
  },
  navBtn: {
    minWidth: 75,
    height: 38,
    borderRadius: 8,
    border: '1px solid rgba(0,0,0,0.15)',
    background: '#ffffffff',
    color: '#111827',
    fontSize: '22px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontWeight: 700,
    cursor: 'pointer',

  },

  // View buttons (right side)
  viewBtn: {
    padding: '10px 22px',
    borderRadius: 8,
    background: '#0c0d54ff',
    color: '#ffffffff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer'
  },
  viewBtnActive: {
    background: '#8b8b8bff',
    color: '#000000ff',
    border: '2px solid #ffffffff'
  },

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
