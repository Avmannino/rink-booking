import React, { useEffect, useState, useMemo, useRef } from 'react';
import axios from 'axios';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import BookingModal from './BookingModal';
import Carousel from "./Carousel";
import AdditionalInfo from './AdditionalInfo';

import './calendar.css'; // dark theme, layout, row heights, mini-cal styling

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

// If you place your logo at frontend/public/logo.png it will be served from /logo.png
const LOGO_SRC = '/logo.png';

// --- small format helpers ---
function fmtDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${totalMin} min`;
}
function fmtStartTime(date) {
  const s = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return s.replace(':00', '');
}
function fmtEndTime(date) {
  const s = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return s.replace(':00', '');
}
function fmtDate(d) {
  return d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}
function fmtUSD(n) {
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  });
}
// YYYY-MM-DD in local time (avoids UTC shifts)
function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  const [calTitle, setCalTitle] = useState('');
  const [currentView, setCurrentView] = useState('timeGridWeek');
  const [currentDate, setCurrentDate] = useState(new Date());

  // mini calendar title + selected day
  const [miniTitle, setMiniTitle] = useState(
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date())
  );
  const [selectedMiniISO, setSelectedMiniISO] = useState(toYMD(new Date()));

  const mainCalRef = useRef(null);
  const miniCalRef = useRef(null);

  // Map API -> FC events (keep all props like price_cents)
  const calendarEvents = useMemo(
    () =>
      events.map((s) => ({
        ...s,
        title: 'Available Ice'
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

  // Unified event label
  const renderEventContent = (arg) => {
    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return null;
    const text = `${fmtStartTime(start)} - Available Ice (${fmtDuration(end - start)})`;
    return <div className="eventText">{text}</div>;
  };

  // Hover tooltip (uses price_cents from API — not a rate) with fade in/out
  const handleMouseEnter = (arg) => {
    arg.el.style.cursor = 'pointer';
    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return;

    const priceCents =
      arg.event.extendedProps && arg.event.extendedProps.price_cents
        ? arg.event.extendedProps.price_cents
        : 0;

    const tip = document.createElement('div');
    tip.className = 'slot-tooltip';
    tip.style.position = 'fixed';
    tip.style.zIndex = '99999';
    tip.style.pointerEvents = 'none';
    tip.style.background = '#0b1220';
    tip.style.border = '1px solid #334155';
    tip.style.borderRadius = '10px';
    tip.style.boxShadow = '0 10px 26px rgba(0,0,0,0.35)';
    tip.style.padding = '10px 12px';
    tip.style.fontSize = '14px';
    tip.style.color = '#e5e7eb';
    tip.style.maxWidth = '300px';
    tip.style.lineHeight = '1.55';
    tip.innerHTML = `
      <div style="font-weight:700; margin-bottom:4px; color:#f1f5f9">Available Ice</div>
      <div><strong>Date:</strong> ${fmtDate(start)}</div>
      <div><strong>Start:</strong> ${fmtStartTime(start)}</div>
      <div><strong>End:</strong> ${fmtEndTime(end)}</div>
      <div style="margin-top:6px;"><strong>Price:</strong> ${fmtUSD(priceCents / 100)}</div>
    `;
    document.body.appendChild(tip);

    // Fade IN (use CSS class toggle)
    requestAnimationFrame(() => {
      tip.classList.add('show');
    });

    const move = (e) => {
      const offX = 12, offY = 12;
      const rect = tip.getBoundingClientRect();
      const vw = innerWidth, vh = innerHeight;
      let x = e.clientX + offX;
      let y = e.clientY - rect.height - offY;
      if (y < 8) y = e.clientY + offY; // flip below
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
    const tip = arg.el._slotTooltip;
    if (tip) {
      // Fade OUT then remove
      tip.classList.remove('show');

      const cleanup = () => {
        tip.removeEventListener('transitionend', cleanup);
        if (tip.parentNode) tip.parentNode.removeChild(tip);
      };
      tip.addEventListener('transitionend', cleanup);
      // Fallback in case transitionend doesn't fire
      setTimeout(cleanup, 250);
      delete arg.el._slotTooltip;
    }
    if (arg.el._slotTooltipMove) {
      document.removeEventListener('mousemove', arg.el._slotTooltipMove);
      delete arg.el._slotTooltipMove;
    }
  };

  // Main calendar API helpers
  const getApi = () =>
    mainCalRef.current && mainCalRef.current.getApi ? mainCalRef.current.getApi() : null;
  const goPrev = () => {
    const api = getApi();
    if (api) {
      api.prev();
      const d = api.getDate();
      setCurrentDate(d);
      setSelectedMiniISO(toYMD(d));
    }
  };
  const goNext = () => {
    const api = getApi();
    if (api) {
      api.next();
      const d = api.getDate();
      setCurrentDate(d);
      setSelectedMiniISO(toYMD(d));
    }
  };
  const switchView = (viewName) => {
    setCurrentView(viewName);
    const api = getApi();
    if (api) {
      api.changeView(viewName);
    }
  };

  // Mini calendar -> jump main date AND show Day view + highlight
  const handleMiniDateClick = (arg) => {
    const api = getApi();
    if (api) {
      api.gotoDate(arg.date);
      api.changeView('timeGridDay');
      setCurrentView('timeGridDay');
      setCurrentDate(arg.date);
      setSelectedMiniISO(toYMD(arg.date));
      setCalTitle(api.view.title);
    }
  };

  // --------- STATIC Additional Info content (edit these strings/JSX) ----------
  const additionalInfoSections = [
    {
      id: 'policies',
      title: 'Arena Policies',
      content: (
        <div>
          <p>
            Helmets required for all skaters under 18. No outside food in bench area.
            Please arrive 15 minutes early for check-in.
          </p>
        </div>
      ),
    },
    {
      id: 'cancellations',
      title: 'Cancellations & Refunds',
      content: (
        <div>
          <p>
            Cancellations must be received 48 hours prior to booking start time
            for a full refund. Inside 48 hours, fees are non-refundable.
          </p>
        </div>
      ),
    },
    {
      id: 'equipment',
      title: 'Equipment & Rentals',
      content: (
        <div>
          <p>
            Skate rentals available on site. The first 15 rentals are Free! Additional rentals are $2/each.
          </p>
        </div>
      ),
    },
    {
      id: 'parking',
      title: 'Parking & Entry',
      content: (
        <div>
          <p>
            Free parking on the south lot. Use the main entrance; the desk is
            immediately to your right for wristbands and waivers.
          </p>
        </div>
      ),
    },
    {
      id: 'contact',
      title: 'Contact & Support',
      content: (
        <div>
          <p>
            Questions? Call (555) 555-0123 or email support@wingsarena.com.
            Front desk staffed 7am–10pm daily.
          </p>
        </div>
      ),
    },
  ];
  // ---------------------------------------------------------------------------

  return (
    <div className="pageWrap">
      {/* LEFT column */}
      <div className="leftCol">
        <a
          href="https://www.wingsarena.com"
          target="_blank"
          rel="noopener noreferrer"
          className="miniLogoLink"
          aria-label="Go to Wings Arena website"
        >
          <img src={LOGO_SRC} alt="Wings Arena" className="miniLogo" />
        </a>

        <aside className="miniWrap">
          <div className="miniHeaderBar">
            <button
              className="miniHeaderBtn"
              type="button"
              onClick={() => {
                const miniApi = miniCalRef.current?.getApi();
                if (miniApi) {
                  miniApi.prev();
                  const title = miniApi.view.title;
                  setMiniTitle(title);
                }
              }}
              aria-label="Previous month"
            >
              ‹
            </button>

            <div className="miniHeaderTitle">{miniTitle}</div>

            <button
              className="miniHeaderBtn"
              type="button"
              onClick={() => {
                const miniApi = miniCalRef.current?.getApi();
                if (miniApi) {
                  miniApi.next();
                  const title = miniApi.view.title;
                  setMiniTitle(title);
                }
              }}
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <FullCalendar
            ref={miniCalRef}
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={false}
            dayHeaderFormat={{ weekday: 'narrow' }}
            fixedWeekCount={false}
            showNonCurrentDates={false}
            expandRows={true}
            height="auto"
            contentHeight="auto"
            dayCellClassNames={(arg) => {
              const classes = ['miniCell'];
              if (toYMD(arg.date) === selectedMiniISO) classes.push('miniSelected');
              return classes;
            }}
            dateClick={handleMiniDateClick}
            initialDate={currentDate}
            datesSet={(info) => {
              setMiniTitle(
                new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
                  info.view.currentStart
                )
              );
            }}
          />
        </aside>

        <Carousel
          images={[
            "/slide1.jpg",
            "/slide2.jpg",
            "/slide3.jpg",
            "/slide4.jpg",
            "/slide5.jpg",
          ]}
          interval={6000}
        />
      </div>

      {/* RIGHT: main calendar */}
      <main className="mainWrap">
        {/* Trigger placed in header area — style/position via your CSS */}
        <AdditionalInfo sections={additionalInfoSections} triggerText="*Additional Info*" />

        <h1 className="title">Ice Reservation Availability</h1>

        <div className="centerNav">
          <button className="navBtn" onClick={goPrev} aria-label="Previous">
            ‹
          </button>
          <div className="currentMonth">
            {calTitle ||
              new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
                currentDate
              )}
          </div>
          <button className="navBtn" onClick={goNext} aria-label="Next">
            ›
          </button>
        </div>

        <div className="viewRow">
          <div className="viewBtns">
            <button
              className={'viewBtn ' + (currentView === 'dayGridMonth' ? 'active' : '')}
              onClick={() => switchView('dayGridMonth')}
            >
              Month
            </button>
            <button
              className={'viewBtn ' + (currentView === 'timeGridWeek' ? 'active' : '')}
              onClick={() => switchView('timeGridWeek')}
            >
              Week
            </button>
            <button
              className={'viewBtn ' + (currentView === 'timeGridDay' ? 'active' : '')}
              onClick={() => switchView('timeGridDay')}
            >
              Day
            </button>
          </div>
        </div>

        {loading && <p className="loading">Loading availability…</p>}

        <FullCalendar
          ref={mainCalRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          headerToolbar={false}
          initialView={currentView}
          timeZone="local"
          allDaySlot={false}
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          slotDuration="00:30:00"
          slotLabelInterval="01:00"
          nowIndicator={true}
          contentHeight={620}
          expandRows={true}
          events={calendarEvents}
          eventClick={handleEventClick}
          eventContent={renderEventContent}
          eventDidMount={(arg) => {
            const el = arg.el;
            el.style.background = '#d6001d7a';
            el.style.border = '1px solid #ffffff95';
            el.style.color = '#e5e7eb';
            el.style.borderRadius = '6px';
            el.style.boxShadow = '0 6px 16px rgba(0,0,0,0.35)';
            el.style.cursor = 'pointer';
            el.style.transform = 'scaleX(0.80)';
            el.style.transformOrigin = 'center';
          }}
          eventMouseEnter={handleMouseEnter}
          eventMouseLeave={handleMouseLeave}
          datesSet={(info) => {
            setCalTitle(info.view.title);
            setCurrentView(info.view.type);
            setCurrentDate(info.view.currentStart);
            setSelectedMiniISO(toYMD(info.view.currentStart));
          }}
          height="auto"
        />

        {selected && (
          <BookingModal
            slot={selected}
            onClose={() => setSelected(null)}
            onCheckout={async (payload) => {
              try {
                const res = await axios.post(`${API_BASE}/api/create-checkout-session`, payload);
                window.location.href = res.data.url;
              } catch (e) {
                alert(e.response?.data?.error || 'Failed to start checkout');
              }
            }}
          />
        )}
      </main>
    </div>
  );
}
