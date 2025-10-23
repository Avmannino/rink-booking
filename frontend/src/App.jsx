import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import BookingModal from './BookingModal';
import TimeSelectionModal from './TimeSelectionModal';
import Carousel from "./Carousel";
import AdditionalInfo from './AdditionalInfo';

import './calendar.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';
const LOGO_SRC = '/logo.png';

// ---- format helpers
function fmtDuration(ms) {
  const t = Math.round(ms / 60000), h = Math.floor(t / 60), m = t % 60;
  if (h === 0) {
    return `${m} minutes`;
  } else if (m === 0) {
    return `${h} hour${h > 1 ? 's' : ''}`;
  } else {
    return `${h} hour${h > 1 ? 's' : ''} ${m} minutes`;
  }
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
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtUSD(n) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}
function toYMD(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

// ===== HOLIDAY HELPERS (blackout) =====
function isFixedHolidayYMD(ymd) {
  const mmdd = ymd.slice(5);
  return mmdd === '01-01' || mmdd === '12-31' || mmdd === '12-24' || mmdd === '12-25';
}
function thanksgivingYMD(year) {
  const d = new Date(Date.UTC(year, 10, 1, 12, 0, 0));
  const day = d.getUTCDay();
  const offsetToThursday = (4 - day + 7) % 7;
  const firstThursday = 1 + offsetToThursday;
  const fourthThursday = firstThursday + 21;
  const y = d.getUTCFullYear();
  const m = '11';
  const dd = String(fourthThursday).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function isHolidayDateLocal(dateLocal) {
  const ymd = toYMD(dateLocal);
  if (isFixedHolidayYMD(ymd)) return true;
  const year = dateLocal.getFullYear();
  return ymd === thanksgivingYMD(year);
}
function startOfLocalDay(d) {
  const nd = new Date(d);
  nd.setHours(0, 0, 0, 0);
  return nd;
}
function addDaysLocal(d, days) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
}
function overlapsHolidayLocal(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || isNaN(start) || isNaN(end)) return false;
  if (end <= start) return false;
  let cursor = startOfLocalDay(start);
  const endBoundary = startOfLocalDay(end);
  while (cursor <= endBoundary) {
    if (isHolidayDateLocal(cursor)) return true;
    cursor = addDaysLocal(cursor, 1);
  }
  return false;
}
const canHover = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* =========================
   Confirmation (full screen)
   ========================= */
function ConfirmationView({ apiBase }) {
  const [state, setState] = useState({
    loading: true,
    ok: false,
    sessionId: '',
    start: '',
    end: '',
    amount_cents: 0,
    currency: 'usd',
    name: '',
    email: ''
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session_id');

    async function confirm() {
      try {
        const { data } = await axios.post(`${apiBase}/api/checkout/confirm`, { session_id: sid });
        setState({
          loading: false,
          ok: !!data?.ok,
          sessionId: sid || '',
          start: data?.start || '',
          end: data?.end || '',
          amount_cents: data?.amount_cents ?? 0,
          currency: data?.currency || 'usd',
          name: data?.name || '',
          email: data?.email || ''
        });
      } catch (e) {
        console.error(e);
        setState(s => ({ ...s, loading: false, ok: false, sessionId: sid || '' }));
      }
    }

    if (sid) confirm();
    else setState(s => ({ ...s, loading: false, ok: false }));
  }, [apiBase]);

  const startDate = state.start ? new Date(state.start) : null;
  const endDate = state.end ? new Date(state.end) : null;
  const amountText = fmtUSD((state.amount_cents || 0) / 100);

  // === Add-to-Calendar helpers (now on success screen) ===
  const safeTitle = `Ice Time Reservation — Wings Arena`;
  const locationText = 'Wings Arena';
  const toICSDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const buildGoogleCalendarUrl = () => {
    if (!startDate || !endDate) return '#';
    const dates = `${toICSDate(startDate)}/${toICSDate(endDate)}`;
    const details =
      `Reserved ice slot at Wings Arena.\n` +
      (state.name ? `Booked by: ${state.name}\n` : '') +
      `Amount Paid: ${amountText}`;
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: safeTitle,
      dates,
      details,
      location: locationText,
      trp: 'true'
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  const downloadICS = () => {
    if (!startDate || !endDate) return;
    const uid = `${state.sessionId || 'sess'}-${startDate.getTime()}@wingsarena`;
    const details =
      `Reserved ice slot at Wings Arena.\\n` +
      (state.name ? `Booked by: ${state.name}\\n` : '') +
      `Amount Paid: ${amountText}`;
    const ics =
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Wings Arena//Bookings//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${toICSDate(new Date())}
DTSTART:${toICSDate(startDate)}
DTEND:${toICSDate(endDate)}
SUMMARY:${safeTitle}
DESCRIPTION:${details}
LOCATION:${locationText}
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const y = startDate.getFullYear();
    const m = String(startDate.getMonth() + 1).padStart(2, '0');
    const d = String(startDate.getDate()).padStart(2, '0');
    const a = document.createElement('a');
    a.href = url;
    a.download = `WingsArena_${y}${m}${d}_IceTime.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (state.loading) {
    return (
      <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0b1220',color:'#e5e7eb'}}>
        <div>Finalizing your booking…</div>
      </div>
    );
  }

  // Use the dedicated confirmation CSS classes
  return (
    <div className="confirmPage">
      <div className="confirmCard">
        <img src="/logo.png" alt="Wings Arena" className="confirmLogo" />
        <h1 className="confirmTitle">
          {state.ok ? 'Booking Confirmed! Get Ready to Glide!' : 'We could not verify your payment'}
        </h1>

        {state.ok ? (
          <>
            {startDate && endDate && (
              <div className="confirmWhen">
                <div className="confirmDate">
                  {startDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div className="confirmTime">
                  {startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
            )}

            <div className="confirmActions">
              <a
                href={buildGoogleCalendarUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="confirmLink"
              >
                Add to Google Calendar
              </a>
              <button className="confirmBtn" onClick={downloadICS}>
                Download .ics (Apple / Outlook)
              </button>
              <button className="confirmBtn" onClick={() => window.print()}>
                Print / Save as PDF
              </button>
              <button
                className="confirmLink"
                onClick={() => { window.location.href = '/'; }}
              >
                Back to Calendar
              </button>
            </div>

            {state.sessionId && (
              <div className="confirmNote">
                Confirmation Ref: {state.sessionId}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="confirmNote">Please contact support if funds were captured but the booking did not finalize.</p>
            <div className="confirmActions">
              <button
                className="confirmLink"
                onClick={() => { window.location.href = '/'; }}
              >
                Back to Calendar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// =========================
// Main Calendar Application
// =========================
export default function App() {
  // If Stripe sent us back after payment, show the full-screen confirmation
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const shouldShowConfirmation = params.get('confirm') === '1' && params.get('session_id');
  if (shouldShowConfirmation) {
    return <ConfirmationView apiBase={API_BASE} />;
  }

  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [timeSelectionSlot, setTimeSelectionSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showDateLimitModal, setShowDateLimitModal] = useState(false);

  const [calTitle, setCalTitle] = useState('');
  const [currentView, setCurrentView] = useState('timeGridWeek');
  const [currentDate, setCurrentDate] = useState(new Date());

  const [miniTitle, setMiniTitle] = useState(
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date())
  );
  const [selectedMiniISO, setSelectedMiniISO] = useState(toYMD(new Date()));
  const [miniCurrentDate, setMiniCurrentDate] = useState(new Date());

  const mainCalRef = useRef(null);
  const miniCalRef = useRef(null);

  // Helper function to check if a date is beyond 60 days
  const isBeyond60Days = (date) => {
    const now = new Date();
    const maxDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    return date > maxDate;
  };

  // Helper function to check if a date is in the past
  const isInPast = (date) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return checkDate < today;
  };

  // Helper function to check if prev navigation is allowed
  const canNavigatePrev = (currentDate, viewType) => {
    const now = new Date();
    const prevDate = new Date(currentDate);
    
    if (viewType === 'dayGridMonth') {
      prevDate.setMonth(prevDate.getMonth() - 1);
      // For month view, only prevent going before current month
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevMonth = new Date(prevDate.getFullYear(), prevDate.getMonth(), 1);
      return prevMonth >= currentMonth;
    } else if (viewType === 'timeGridWeek') {
      prevDate.setDate(prevDate.getDate() - 7);
      // For week view, only prevent going before current week
      const currentWeekStart = new Date(now);
      currentWeekStart.setDate(now.getDate() - now.getDay()); // Start of current week
      currentWeekStart.setHours(0, 0, 0, 0);
      const prevWeekStart = new Date(prevDate);
      prevWeekStart.setDate(prevDate.getDate() - prevDate.getDay());
      prevWeekStart.setHours(0, 0, 0, 0);
      return prevWeekStart >= currentWeekStart;
    } else if (viewType === 'timeGridDay') {
      prevDate.setDate(prevDate.getDate() - 1);
      // For day view, prevent going before today
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const prevDay = new Date(prevDate.getFullYear(), prevDate.getMonth(), prevDate.getDate());
      return prevDay >= today;
    }
    
    return true;
  };

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

  const calendarEvents = useMemo(
    () => events.map((s) => ({ ...s, title: 'Available Ice' })),
    [events]
  );

  const availableDaysSet = useMemo(() => {
    const s = new Set();
    for (const ev of events) {
      if (!ev?.start) continue;
      const d = new Date(ev.start);
      if (!isNaN(d)) s.add(toYMD(d));
    }
    return s;
  }, [events]);

  const miniAvailKey = useMemo(
    () => Array.from(availableDaysSet).sort().join(','),
    [availableDaysSet]
  );

  const getMiniDayCellClassNames = useCallback(
    (arg) => {
      const classes = ['miniCell'];
      const ymd = toYMD(arg.date);
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

  const miniDayCellDidMount = useCallback((arg) => {
    const ymd = toYMD(arg.date);
    const numEl = arg.el.querySelector('.fc-daygrid-day-number');
    if (!numEl) return;

    const inMonth =
      arg.view.currentStart.getMonth() === arg.date.getMonth() &&
      arg.view.currentStart.getFullYear() === arg.date.getFullYear();

    if (!inMonth) {
      numEl.style.color = '#64748b';
      return;
    }

    numEl.style.fontWeight = '800';
    numEl.style.color = availableDaysSet.has(ymd) ? '#22c55e' : '#ef4444';
  }, [availableDaysSet]);

  // Fetch slots (filter out holiday overlaps)
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await axios.get(`${API_BASE}/api/slots`);
        const raw = Array.isArray(data) ? data : [];

        const filtered = raw.filter((s) => {
          const start = new Date(s.start);
          const end = new Date(s.end);
          if (isNaN(start) || isNaN(end)) return false;
          return !overlapsHolidayLocal(start, end);
        });

        setEvents(filtered);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleEventClick = (info) => {
    const slot = events.find((e) => e.id === info.event.id);
    if (slot) setTimeSelectionSlot(slot);
  };

  const handleTimeSelectionProceed = (validatedSlot) => {
    setSelected(validatedSlot);
    setTimeSelectionSlot(null);
  };

  const handleTimeSelectionClose = () => {
    setTimeSelectionSlot(null);
  };

  const renderEventContent = (arg) => {
    const start = arg.event.start, end = arg.event.end;
    if (!start || !end) return null;
    const text = `${fmtStartTime(start)} - Available Ice (${fmtDuration(end - start)})`;
    return <div className="eventText">{text}</div>;
  };

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
      const currentDate = api.getDate();
      
      // Check if prev navigation is allowed
      if (!canNavigatePrev(currentDate, currentView)) {
        return; // Don't navigate to past dates
      }
      
      api.prev();
      const d = api.getDate();
      setCurrentDate(d);
      setSelectedMiniISO(toYMD(d));
    }
  };
  const goNext = () => {
    const api = getApi();
    if (api) {
      const currentDate = api.getDate();
      const nextDate = new Date(currentDate);
      
      // Calculate what the next date would be based on current view
      if (currentView === 'dayGridMonth') {
        nextDate.setMonth(nextDate.getMonth() + 1);
      } else if (currentView === 'timeGridWeek') {
        nextDate.setDate(nextDate.getDate() + 7);
      } else if (currentView === 'timeGridDay') {
        nextDate.setDate(nextDate.getDate() + 1);
      }
      
      // Check if the next date would be beyond 60 days
      if (isBeyond60Days(nextDate)) {
        setShowDateLimitModal(true);
        return;
      }
      
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

  const handleMainDateClick = useCallback((info) => {
    if (info.view.type !== 'dayGridMonth') return;
    const api = getApi();
    if (!api) return;
    api.gotoDate(info.date);
    api.changeView('timeGridDay');
    setCurrentView('timeGridDay');
    setCurrentDate(info.date);
    setSelectedMiniISO(toYMD(info.date));
    setCalTitle(api.view.title);
  }, []);

  const handleMainDayCellDidMount = useCallback((arg) => {
    if (arg.view.type !== 'dayGridMonth') return;
    const td = arg.el;
    const frame = td.querySelector('.fc-daygrid-day-frame') || td;
    frame.style.cursor = 'pointer';
    const onEnter = () => {
      td.style.outline = '2px solid #334155';
      td.style.outlineOffset = '-1px';
    };
    const onLeave = () => {
      td.style.outline = '';
      td.style.outlineOffset = '';
    };
    td.addEventListener('mouseenter', onEnter);
    td.addEventListener('mouseleave', onLeave);
    td._monthHoverEnter = onEnter;
    td._monthHoverLeave = onLeave;
  }, []);

  const handleMainDayCellWillUnmount = useCallback((arg) => {
    const td = arg.el;
    const frame = td.querySelector('.fc-daygrid-day-frame') || td;
    if (td._monthHoverEnter) {
      td.removeEventListener('mouseenter', td._monthHoverEnter);
      delete td._monthHoverEnter;
    }
    if (td._monthHoverLeave) {
      td.removeEventListener('mouseleave', td._monthHoverLeave);
      delete td._monthHoverLeave;
    }
    frame.style.cursor = '';
    td.style.outline = '';
    td.style.outlineOffset = '';
  }, []);

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
        {/* Wrap the logo IMG in a span so ::before/::after spray can render */}
        <span className="logoSkater">
          <img src={LOGO_SRC} alt="Wings Arena" className="miniLogo" />
        </span>

        {/* Mobile shows Additional Info trigger too */}
        {isMobile && (
          <AdditionalInfo
            sections={additionalInfoSections}
            triggerText="Additional Info"
            footerNote="The booking calendar reflects available ice times 60 days out. If you'd like to inquire about a booking past 60 days, please email info@wingsarena.com."
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
                    if (miniApi) {
                      const miniDate = miniApi.getDate();
                      
                      if (!canNavigatePrev(miniDate, 'dayGridMonth')) {
                        return; // Don't navigate to past dates
                      }
                      
                      miniApi.prev();
                      const newDate = miniApi.getDate();
                      setMiniTitle(miniApi.view.title);
                      setMiniCurrentDate(newDate);
                    }
                  }}
                  disabled={!canNavigatePrev(miniCurrentDate, 'dayGridMonth')}
                  style={{ 
                    opacity: canNavigatePrev(miniCurrentDate, 'dayGridMonth') ? 1 : 0.3,
                    cursor: canNavigatePrev(miniCurrentDate, 'dayGridMonth') ? 'pointer' : 'not-allowed'
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
                    if (miniApi) {
                      const miniDate = miniApi.getDate();
                      const nextDate = new Date(miniDate);
                      nextDate.setMonth(nextDate.getMonth() + 1);
                      
                      if (isBeyond60Days(nextDate)) {
                        setShowDateLimitModal(true);
                        return;
                      }
                      
                      miniApi.next();
                      const newDate = miniApi.getDate();
                      setMiniTitle(miniApi.view.title);
                      setMiniCurrentDate(newDate);
                    }
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
                datesSet={(info) => {
                  setMiniTitle(
                    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
                      .format(info.view.currentStart)
                  );
                  setMiniCurrentDate(info.view.currentStart);
                }}
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
                    if (miniApi) {
                      const miniDate = miniApi.getDate();
                      
                      if (!canNavigatePrev(miniDate, 'dayGridMonth')) {
                        return; // Don't navigate to past dates
                      }
                      
                      miniApi.prev();
                      const newDate = miniApi.getDate();
                      setMiniTitle(miniApi.view.title);
                      setMiniCurrentDate(newDate);
                    }
                  }}
                  disabled={!canNavigatePrev(miniCurrentDate, 'dayGridMonth')}
                  style={{ 
                    opacity: canNavigatePrev(miniCurrentDate, 'dayGridMonth') ? 1 : 0.3,
                    cursor: canNavigatePrev(miniCurrentDate, 'dayGridMonth') ? 'pointer' : 'not-allowed'
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
                    if (miniApi) {
                      const miniDate = miniApi.getDate();
                      const nextDate = new Date(miniDate);
                      nextDate.setMonth(nextDate.getMonth() + 1);
                      
                      if (isBeyond60Days(nextDate)) {
                        setShowDateLimitModal(true);
                        return;
                      }
                      
                      miniApi.next();
                      const newDate = miniApi.getDate();
                      setMiniTitle(miniApi.view.title);
                      setMiniCurrentDate(newDate);
                    }
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
                datesSet={(info) => {
                  setMiniTitle(
                    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
                      .format(info.view.currentStart)
                  );
                  setMiniCurrentDate(info.view.currentStart);
                }}
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
            footerNote="The booking calendar reflects available ice times 60 days out. If you'd like to inquire about a booking past 60 days, please email info@wingsarena.com."
          />

          <h1 className="title">Wings Arena Ice Reservations</h1>

          <div className="centerNav">
            <button 
              className="navBtn" 
              onClick={goPrev} 
              aria-label="Previous"
              disabled={!canNavigatePrev(currentDate, currentView)}
              style={{ 
                opacity: canNavigatePrev(currentDate, currentView) ? 1 : 0.3,
                cursor: canNavigatePrev(currentDate, currentView) ? 'pointer' : 'not-allowed'
              }}
            >
              ‹
            </button>
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
            dateClick={handleMainDateClick}
            dayCellDidMount={handleMainDayCellDidMount}
            dayCellWillUnmount={handleMainDayCellWillUnmount}
            eventDidMount={(arg) => {
              const el = arg.el;
              el.style.background = '#d6001d7a';
              el.style.border = '1px solid #ffffff95';
              el.style.color = '#e5e7eb';
              el.style.borderRadius = '6px';
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

      {/* Time selection modal */}
      {timeSelectionSlot && (
        <TimeSelectionModal
          slot={timeSelectionSlot}
          onClose={handleTimeSelectionClose}
          onProceed={handleTimeSelectionProceed}
        />
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

      {/* Date limit modal */}
      {showDateLimitModal && (
        <div style={dateLimitModalStyles.backdrop}>
          <div style={dateLimitModalStyles.modal}>
            <h2 style={{ marginTop: 0, color: '#E6E8F0' }}>
              Booking Calendar Limit
            </h2>
            <p style={{ color: '#CBD5E1', marginBottom: 20 }}>
              The booking calendar reflects available ice times over the next 60 days. 
              If you'd like to inquire about a booking past 60 days, please email info@wingsarena.com.
            </p>
            <div style={dateLimitModalStyles.buttonGroup}>
              <button 
                type="button" 
                onClick={() => setShowDateLimitModal(false)} 
                style={dateLimitModalStyles.primaryBtn}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const dateLimitModalStyles = {
  backdrop: { 
    position: 'fixed', 
    inset: 0, 
    background: 'rgba(0,0,0,0.5)', 
    display: 'grid', 
    placeItems: 'center', 
    padding: 16, 
    zIndex: 9999 
  },
  modal: { 
    width: '100%', 
    maxWidth: 480, 
    background: '#0f172a', 
    border: '1px solid #1f2a44', 
    borderRadius: 12, 
    padding: 24, 
    boxShadow: '0 16px 32px rgba(0,0,0,0.45)' 
  },
  buttonGroup: { 
    display: 'flex', 
    gap: 8, 
    justifyContent: 'center', 
    marginTop: 8
  },
  primaryBtn: { 
    appearance: 'none', 
    border: 'none', 
    borderRadius: 9999, 
    padding: '12px 24px', 
    fontWeight: 600, 
    cursor: 'pointer', 
    background: '#4f46e5', 
    color: '#fff',
    fontSize: 16
  }
};
