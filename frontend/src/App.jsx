import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import BookingModal from './BookingModal';
import Carousel from "./Carousel";
import AdditionalInfo from './AdditionalInfo';

import './calendar.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';
const LOGO_SRC = '/logo.png';

// ---- format helpers
function fmtDuration(ms) {
  const t = Math.round(ms / 60000), h = Math.floor(t / 60), m = t % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${t} min`;
}
function fmtStartTime(d) {
  const s = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return s.replace(':00', '');
}
function fmtEndTime(d) {
  const s = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return s.replace(':00', '');
}
function fmtDate(d) {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtUSD(n) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}
function toYMD(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

// Real hover check (desktop only typically)
const canHover = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export default function App() {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  const [calTitle, setCalTitle] = useState('');
  const [currentView, setCurrentView] = useState('timeGridWeek');
  const [currentDate, setCurrentDate] = useState(new Date());

  const [miniTitle, setMiniTitle] = useState(
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date())
  );
  const [selectedMiniISO, setSelectedMiniISO] = useState(toYMD(new Date()));

  const mainCalRef = useRef(null);
  const miniCalRef = useRef(null);

  // Mobile state
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 980px)').matches : false
  );
  const [mobileDayOpen, setMobileDayOpen] = useState(false);
  const [mobileDayDate, setMobileDayDate] = useState(new Date());
  const mobileDayRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 980px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener?.('change', onChange) || mq.addListener(onChange);
    return () => (mq.removeEventListener?.('change', onChange) || mq.removeListener(onChange));
  }, []);

  useEffect(() => {
    if (!isMobile || !mobileDayOpen) return;
    const api = mobileDayRef.current?.getApi?.();
    if (api) api.gotoDate(mobileDayDate);
  }, [isMobile, mobileDayOpen, mobileDayDate]);

  // Normalize events for FC
  const calendarEvents = useMemo(
    () => events.map((s) => ({ ...s, title: 'Available Ice' })),
    [events]
  );

  // Set of YYYY-MM-DD that have at least one event (for mini-cal coloring)
  const availableDaysSet = useMemo(() => {
    const s = new Set();
    for (const ev of events) {
      if (!ev?.start) continue;
      const d = new Date(ev.start);
      if (!isNaN(d)) s.add(toYMD(d));
    }
    return s;
  }, [events]);

  // Key to force the mini calendars to remount when availability changes
  const miniAvailKey = useMemo(
    () => Array.from(availableDaysSet).sort().join(','),
    [availableDaysSet]
  );

  // Classnames for mini calendar cells (desktop + mobile)
  const getMiniDayCellClassNames = useCallback(
    (arg) => {
      const classes = ['miniCell'];
      const ymd = toYMD(arg.date);

      // Only color days that belong to the visible month
      const inMonth =
        arg.view.currentStart.getMonth() === arg.date.getMonth() &&
        arg.view.currentStart.getFullYear() === arg.date.getFullYear();

      if (ymd === selectedMiniISO) classes.push('miniSelected');
      if (inMonth) {
        classes.push(availableDaysSet.has(ymd) ? 'hasAvail' : 'noAvail');
      }
      return classes;
    },
    [selectedMiniISO, availableDaysSet]
  );

  // FORCE color on day numbers (handles theme specificity)
  const miniDayCellDidMount = useCallback((arg) => {
    const ymd = toYMD(arg.date);
    const numEl = arg.el.querySelector('.fc-daygrid-day-number');
    if (!numEl) return;

    const inMonth =
      arg.view.currentStart.getMonth() === arg.date.getMonth() &&
      arg.view.currentStart.getFullYear() === arg.date.getFullYear();

    if (!inMonth) {
      numEl.style.color = '#64748b'; // muted out-of-month
      return;
    }

    numEl.style.fontWeight = '800';
    numEl.style.color = availableDaysSet.has(ymd) ? '#22c55e' : '#ef4444';
  }, [availableDaysSet]);

  // Fetch slots
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

  // Click on an event (both desktop & mobile day view)
  const handleEventClick = (info) => {
    const slot = events.find((e) => e.id === info.event.id);
    if (slot) setSelected(slot);
  };

  // Event label
  const renderEventContent = (arg) => {
    const start = arg.event.start, end = arg.event.end;
    if (!start || !end) return null;
    const text = `${fmtStartTime(start)} - Available Ice (${fmtDuration(end - start)})`;
    return <div className="eventText">{text}</div>;
  };

  // Tooltip (desktop/hover devices only)
  const handleMouseEnter = (arg) => {
    if (!canHover()) return;
    arg.el.style.cursor = 'pointer';
    const start = arg.event.start, end = arg.event.end;
    if (!start || !end) return;

    const priceCents = arg.event.extendedProps?.price_cents ?? 0;
    const tip = document.createElement('div');
    tip.className = 'slot-tooltip';
    Object.assign(tip.style, {
      position: 'fixed',
      zIndex: '99999',
      pointerEvents: 'none',
      background: '#0b1220',
      border: '1px solid #334155',
      borderRadius: '10px',
      boxShadow: '0 10px 26px rgba(0,0,0,0.35)',
      padding: '10px 12px',
      fontSize: '14px',
      color: '#e5e7eb',
      maxWidth: '300px',
      lineHeight: '1.55',
      opacity: '0',
      transform: 'translateY(4px)',
      transition: 'opacity 160ms ease, transform 160ms ease'
    });
    tip.innerHTML = `
      <div style="font-weight:700; margin-bottom:4px; color:#f1f5f9">Available Ice</div>
      <div><strong>Date:</strong> ${fmtDate(start)}</div>
      <div><strong>Start:</strong> ${fmtStartTime(start)}</div>
      <div><strong>End:</strong> ${fmtEndTime(end)}</div>
      <div style="margin-top:6px;"><strong>Price:</strong> ${fmtUSD(priceCents / 100)}</div>
    `;
    document.body.appendChild(tip);

    const move = (e) => {
      const offX = 12, offY = 12;
      const rect = tip.getBoundingClientRect();
      const vw = innerWidth, vh = innerHeight;
      let x = e.clientX + offX;
      let y = e.clientY - rect.height - offY;
      if (y < 8) y = e.clientY + offY;
      if (x + rect.width + 8 > vw) x = vw - rect.width - 8;
      if (y + rect.height + 8 > vh) y = vh - rect.height - 8;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    };
    document.addEventListener('mousemove', move);

    requestAnimationFrame(() => {
      tip.style.opacity = '1';
      tip.style.transform = 'translateY(0)';
    });

    arg.el._slotTooltip = tip;
    arg.el._slotTooltipMove = move;
    if (arg.jsEvent) move(arg.jsEvent);
  };

  const handleMouseLeave = (arg) => {
    if (!canHover()) return;
    arg.el.style.cursor = '';
    const tip = arg.el._slotTooltip;
    const move = arg.el._slotTooltipMove;
    if (move) {
      document.removeEventListener('mousemove', move);
      delete arg.el._slotTooltipMove;
    }
    if (tip) {
      tip.style.opacity = '0';
      tip.style.transform = 'translateY(4px)';
      setTimeout(() => tip.remove(), 170);
      delete arg.el._slotTooltip;
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
    if (api) api.changeView(viewName);
  };

  // Mini calendar click behavior
  const handleMiniDateClick = (arg) => {
    if (isMobile) {
      setMobileDayDate(arg.date);
      setMobileDayOpen(true);
      setSelectedMiniISO(toYMD(arg.date));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
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

  // Additional Info sections (static)
  const additionalInfoSections = [
    { id: 'policies', title: 'Arena Policies', content: <div><p>Helmets required for all skaters under 18. No outside food in bench area. Please arrive 15 minutes early for check-in.</p></div> },
    { id: 'cancellations', title: 'Cancellations & Refunds', content: <div><p>Cancellations must be received 48 hours prior to booking start time for a full refund. Inside 48 hours, fees are non-refundable.</p></div> },
    { id: 'equipment', title: 'Equipment & Rentals', content: <div><p>Skate rentals available on site. The first 15 rentals are free; additional rentals are $2 each.</p></div> },
    { id: 'parking', title: 'Parking & Entry', content: <div><p>Free parking on the south lot. Use the main entrance; the desk is immediately to your right for wristbands and waivers.</p></div> },
    { id: 'contact', title: 'Contact & Support', content: <div><p>Questions? Call (555) 555-0123 or email support@wingsarena.com. Front desk staffed 7am–10pm daily.</p></div> },
  ];

  return (
    <div className="pageWrap">
      {/* LEFT column */}
      <div className="leftCol">
        <img src={LOGO_SRC} alt="Wings Arena" className="miniLogo" />

        {/* Mobile shows Additional Info trigger too */}
        {isMobile && (
          <AdditionalInfo
            sections={additionalInfoSections}
            triggerText="Additional Info"
            footerNote="The booking calendar reflects available ice times 90 days out. If you'd like to inquire about a booking past 90 days, please email info@wingsarena.com."
          />
        )}

        {/* DESKTOP: mini calendar + carousel */}
        {!isMobile && (
          <>
            <aside className="miniWrap">
              <div className="miniHeaderBar">
                <button
                  className="miniHeaderBtn"
                  type="button"
                  onClick={() => {
                    const miniApi = miniCalRef.current?.getApi();
                    if (miniApi) { miniApi.prev(); setMiniTitle(miniApi.view.title); }
                  }}
                >
                  ‹
                </button>
                <div className="miniHeaderTitle">{miniTitle}</div>
                <button
                  className="miniHeaderBtn"
                  type="button"
                  onClick={() => {
                    const miniApi = miniCalRef.current?.getApi();
                    if (miniApi) { miniApi.next(); setMiniTitle(miniApi.view.title); }
                  }}
                >
                  ›
                </button>
              </div>

              <FullCalendar
                key={miniAvailKey}
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
                dayCellClassNames={getMiniDayCellClassNames}
                dayCellDidMount={miniDayCellDidMount}
                dateClick={handleMiniDateClick}
                initialDate={currentDate}
                datesSet={(info) =>
                  setMiniTitle(
                    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
                      .format(info.view.currentStart)
                  )
                }
              />
            </aside>

            <Carousel
              images={["/slide1.jpg", "/slide2.jpg", "/slide3.jpg", "/slide4.jpg", "/slide5.jpg"]}
              interval={6000}
            />
          </>
        )}

        {/* MOBILE: mini calendar + carousel (when not in day view) */}
        {isMobile && !mobileDayOpen && (
          <>
            <h1 className="title mobileTitle">Ice Reservation Availability</h1>
            <aside className="miniWrap">
              <div className="miniHeaderBar">
                <button
                  className="miniHeaderBtn"
                  type="button"
                  onClick={() => {
                    const miniApi = miniCalRef.current?.getApi();
                    if (miniApi) { miniApi.prev(); setMiniTitle(miniApi.view.title); }
                  }}
                >
                  ‹
                </button>
                <div className="miniHeaderTitle">{miniTitle}</div>
                <button
                  className="miniHeaderBtn"
                  type="button"
                  onClick={() => {
                    const miniApi = miniCalRef.current?.getApi();
                    if (miniApi) { miniApi.next(); setMiniTitle(miniApi.view.title); }
                  }}
                >
                  ›
                </button>
              </div>

              <FullCalendar
                key={miniAvailKey}
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
                dayCellClassNames={getMiniDayCellClassNames}
                dayCellDidMount={miniDayCellDidMount}
                dateClick={handleMiniDateClick}
                initialDate={currentDate}
                datesSet={(info) =>
                  setMiniTitle(
                    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
                      .format(info.view.currentStart)
                  )
                }
              />
            </aside>

            <Carousel
              images={["/slide1.jpg", "/slide2.jpg", "/slide3.jpg", "/slide4.jpg", "/slide5.jpg"]}
              interval={6000}
            />
          </>
        )}

        {/* MOBILE day view */}
        {isMobile && mobileDayOpen && (
          <section className="mobileDayWrap">
            <div className="mobileDayHeader">
              <button className="mobileBackBtn" onClick={() => setMobileDayOpen(false)}>⮜ Back</button>
              <div className="mobileDayTitle">
                {new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                  .format(mobileDayDate)}
              </div>
              <span className="mobileHeaderSpacer" />
            </div>

            <FullCalendar
              key={toYMD(mobileDayDate)}
              ref={mobileDayRef}
              plugins={[timeGridPlugin, interactionPlugin]}
              initialView="timeGridDay"
              headerToolbar={false}
              timeZone="local"
              allDaySlot={false}
              slotMinTime="06:00:00"
              slotMaxTime="22:00:00"
              slotDuration="00:30:00"
              slotLabelInterval="01:00"
              height="auto"
              contentHeight={560}
              expandRows={true}
              initialDate={mobileDayDate}
              events={calendarEvents}
              eventClick={handleEventClick}
              eventContent={renderEventContent}
              eventMouseEnter={handleMouseEnter}
              eventMouseLeave={handleMouseLeave}
              eventDidMount={(arg) => {
                const el = arg.el;
                el.style.background = '#d6001d7a';
                el.style.border = '1px solid #ffffff95';
                el.style.color = '#e5e7eb';
                el.style.borderRadius = '6px';
                el.style.boxShadow = '0 6px 16px rgba(0,0,0,0.35)';
                el.style.transform = 'scaleX(0.92)';
                el.style.transformOrigin = 'center';
              }}
              datesSet={(info) => {
                setCurrentDate(info.view.currentStart);
                setSelectedMiniISO(toYMD(info.view.currentStart));
              }}
            />
          </section>
        )}
      </div>

      {/* RIGHT: main calendar */}
      {!isMobile && (
        <main className="mainWrap">
          <AdditionalInfo
            sections={additionalInfoSections}
            triggerText="Additional Info"
            footerNote="The booking calendar reflects available ice times 90 days out. If you'd like to inquire about a booking past 90 days, please email info@wingsarena.com."
          />

          <h1 className="title">Ice Reservation Availability</h1>

          <div className="centerNav">
            <button className="navBtn" onClick={goPrev} aria-label="Previous">‹</button>
            <div className="currentMonth">
              {calTitle || new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(currentDate)}
            </div>
            <button className="navBtn" onClick={goNext} aria-label="Next">›</button>
          </div>

          <div className="viewRow">
            <div className="viewBtns">
              <button className={'viewBtn ' + (currentView === 'dayGridMonth' ? 'active' : '')} onClick={() => switchView('dayGridMonth')}>Month</button>
              <button className={'viewBtn ' + (currentView === 'timeGridWeek' ? 'active' : '')} onClick={() => switchView('timeGridWeek')}>Week</button>
              <button className={'viewBtn ' + (currentView === 'timeGridDay' ? 'active' : '')} onClick={() => switchView('timeGridDay')}>Day</button>
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
            eventMouseEnter={handleMouseEnter}
            eventMouseLeave={handleMouseLeave}
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
            datesSet={(info) => {
              setCalTitle(info.view.title);
              setCurrentView(info.view.type);
              setCurrentDate(info.view.currentStart);
              setSelectedMiniISO(toYMD(info.view.currentStart));
            }}
            height="auto"
          />
        </main>
      )}

      {/* Booking modal (both desktop and mobile) */}
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
    </div>
  );
}
