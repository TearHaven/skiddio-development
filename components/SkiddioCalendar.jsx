"use client";

import { useEffect, useRef, useState } from "react";
import {
  dateString,
  formatTime,
  localDateString,
  shiftScheduleByMinutes,
  taskPlacement,
  timeToMinutes,
} from "@/lib/tasks";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const VIEWS = ["month", "week", "day"];

function getStartOfWeek(d) {
  const date = new Date(d);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function getEventsForDay(events, year, month, day) {
  const targetDate = localDateString(new Date(year, month, day));
  return events.flatMap((event) => {
    const placement = taskPlacement(event);
    if (targetDate < placement.date || targetDate > placement.endDate) return [];
    if (targetDate === placement.endDate && targetDate !== placement.date && event.endTime === "00:00") return [];

    return [{
      ...event,
      segmentDate: targetDate,
      segmentStartTime: targetDate === placement.date ? event.startTime : "00:00",
      segmentEndTime: targetDate === placement.endDate ? event.endTime : "24:00",
    }];
  }).sort((a, b) => {
    const first = timeToMinutes(a.segmentStartTime || "00:00");
    const second = timeToMinutes(b.segmentStartTime || "00:00");
    return first - second || a.title.localeCompare(b.title);
  });
}

function layoutOverlappingEvents(events) {
  const groups = [];
  let group = [];
  let groupEnd = -1;

  for (const event of events) {
    const start = timeToMinutes(event.segmentStartTime);
    const end = timeToMinutes(event.segmentEndTime);
    if (group.length && start >= groupEnd) {
      groups.push(group);
      group = [];
      groupEnd = -1;
    }
    group.push(event);
    groupEnd = Math.max(groupEnd, end);
  }
  if (group.length) groups.push(group);

  return groups.flatMap((overlapGroup) => {
    const positioned = [];
    let columnCount = 0;
    for (const event of overlapGroup) {
      const start = timeToMinutes(event.segmentStartTime);
      const end = timeToMinutes(event.segmentEndTime);
      const active = positioned.filter((item) => item.end > start);
      const usedColumns = new Set(active.map((item) => item.column));
      let column = 0;
      while (usedColumns.has(column)) column += 1;
      positioned.push({ event, start, end, column });
      columnCount = Math.max(columnCount, column + 1);
    }

    return positioned.map(({ event, column }) => ({
      ...event,
      overlapColumn: column,
      overlapColumns: columnCount,
    }));
  });
}

function EventCheckbox({ evt, onToggle }) {
  const [busy, setBusy] = useState(false);
  if (!onToggle) return null;

  const label = `Mark ${evt.title} ${evt.completed ? "unfinished" : "finished"}`;
  return (
    <input
      type="checkbox"
      className="cal-event-checkbox"
      checked={Boolean(evt.completed)}
      disabled={busy}
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await onToggle(evt, e.target.checked);
        } catch (error) {
          console.error("Could not update schedule completion:", error);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

export default function SkiddioCalendar({
  events = [],
  focusDate = null,
  onEventClick,
  onEventEdit,
  onEventToggle,
  onEventDrop,
  onCreateEvent,
  onShare,
}) {
  const [view, setView] = useState("month");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [showHalfHours, setShowHalfHours] = useState(false);
  const [dayOrientation, setDayOrientation] = useState("vertical");

  // Latest props/state for the document-level drag handlers (which are created once)
  const live = useRef({});
  live.current = { view, dayOrientation, onEventClick, onEventEdit, onEventDrop };

  const grid = useRef({ start: 0, end: 23 });
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const clickTimer = useRef(null);
  const handlers = useRef(null);

  // The parent can ask the calendar to jump to a date (e.g. after editing a schedule)
  useEffect(() => {
    if (focusDate) setCurrentDate(new Date(focusDate));
  }, [focusDate]);

  if (!handlers.current) {
    const dropSelector = () => (live.current.view === "month" ? ".skiddio-cal-cell[data-date]" : ".time-day-col[data-date]");

    const move = (pointerEvent) => {
      const d = drag.current;
      if (!d || pointerEvent.pointerId !== d.pointerId) return;

      if (!d.ghost) {
        const distance = Math.hypot(pointerEvent.clientX - d.startX, pointerEvent.clientY - d.startY);
        if (distance < 5) return;

        d.element.classList.add("is-dragging");
        d.ghost = d.element.cloneNode(true);
        d.ghost.classList.add("cal-event-drag-ghost");
        d.ghost.style.width = `${d.rect.width}px`;
        d.ghost.style.height = `${d.rect.height}px`;
        d.ghost.style.left = `${d.rect.left}px`;
        d.ghost.style.top = `${d.rect.top}px`;
        document.body.appendChild(d.ghost);
      }

      d.ghost.style.left = `${pointerEvent.clientX - d.offsetX}px`;
      d.ghost.style.top = `${pointerEvent.clientY - d.offsetY}px`;

      const underPointer = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
      const target = underPointer?.closest(dropSelector()) || null;
      if (d.dropTarget !== target) {
        d.dropTarget?.classList.remove("drop-target");
        d.dropTarget = target;
        d.dropTarget?.classList.add("drop-target");
      }

      const collisionElement = underPointer?.closest("[data-event-id]");
      const collisionTarget = collisionElement && collisionElement !== d.element ? collisionElement : null;
      if (d.collisionTarget !== collisionTarget) {
        d.collisionTarget?.classList.remove("is-collision-target");
        d.collisionTarget = collisionTarget;
        d.collisionTarget?.classList.add("is-collision-target");
      }
    };

    const up = (pointerEvent) => {
      const d = drag.current;
      if (!d || pointerEvent.pointerId !== d.pointerId) return;

      const didDrag = Boolean(d.ghost);
      const underPointer = didDrag && pointerEvent.type !== "pointercancel"
        ? document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)
        : null;
      const target = underPointer?.closest(dropSelector());

      d.dropTarget?.classList.remove("drop-target");
      d.collisionTarget?.classList.remove("is-collision-target");
      d.element.classList.remove("is-dragging");
      d.ghost?.remove();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      drag.current = null;

      if (!didDrag) return;
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 250);
      if (!target) return;

      const placement = taskPlacement(d.event);
      const segmentDate = dateString(d.event.segmentDate || placement.date);
      const segmentStartTime = d.event.segmentStartTime || d.event.startTime;
      const segmentEndTime = d.event.segmentEndTime || d.event.endTime;
      let nextSegmentStart = timeToMinutes(segmentStartTime);
      if (live.current.view !== "month") {
        const rect = target.getBoundingClientRect();
        const { start, end } = grid.current;
        const gridMinutes = (end - start + 1) * 60;
        if (live.current.view === "day" && live.current.dayOrientation === "horizontal") {
          const duration = timeToMinutes(segmentEndTime) - timeToMinutes(segmentStartTime);
          const eventLeft = pointerEvent.clientX - d.offsetX;
          const minutesFromLeft = Math.max(0, Math.min(1, (eventLeft - rect.left) / rect.width)) * gridMinutes;
          const latestStart = Math.max(start * 60, start * 60 + gridMinutes - duration);
          const proposedStart = start * 60 + Math.round(minutesFromLeft / 15) * 15;
          nextSegmentStart = Math.max(start * 60, Math.min(latestStart, proposedStart));
        } else {
          const duration = timeToMinutes(segmentEndTime) - timeToMinutes(segmentStartTime);
          const eventTop = pointerEvent.clientY - d.offsetY;
          const minutesFromTop = Math.max(0, Math.min(1, (eventTop - rect.top) / rect.height)) * gridMinutes;
          const latestStart = Math.max(start * 60, start * 60 + gridMinutes - duration);
          const proposedStart = start * 60 + Math.round(minutesFromTop / 15) * 15;
          nextSegmentStart = Math.max(start * 60, Math.min(latestStart, proposedStart));
        }
      }

      const oldSegmentStart = Math.floor(Date.parse(`${segmentDate}T00:00:00Z`) / 86400000) * 1440
        + timeToMinutes(segmentStartTime);
      const targetSegmentStart = Math.floor(Date.parse(`${target.dataset.date}T00:00:00Z`) / 86400000) * 1440
        + nextSegmentStart;
      const destination = shiftScheduleByMinutes(placement, targetSegmentStart - oldSegmentStart);

      Promise.resolve(live.current.onEventDrop?.(d.event, destination))
        .catch((error) => console.error("Could not move calendar event:", error));
    };

    handlers.current = { move, up };
  }

  // Clean up if the calendar unmounts mid-drag
  useEffect(() => {
    const { move, up } = handlers.current;
    return () => {
      window.clearTimeout(clickTimer.current);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      drag.current?.ghost?.remove();
      drag.current = null;
    };
  }, []);

  function startEventDrag(evt, pointerEvent) {
    if (pointerEvent.button !== 0 || !live.current.onEventDrop) return;

    window.clearTimeout(clickTimer.current);
    const element = pointerEvent.currentTarget;
    const rect = element.getBoundingClientRect();
    drag.current = {
      event: evt,
      element,
      pointerId: pointerEvent.pointerId,
      startX: pointerEvent.clientX,
      startY: pointerEvent.clientY,
      offsetX: pointerEvent.clientX - rect.left,
      offsetY: pointerEvent.clientY - rect.top,
      rect,
      ghost: null,
      dropTarget: null,
      collisionTarget: null,
    };
    document.addEventListener("pointermove", handlers.current.move);
    document.addEventListener("pointerup", handlers.current.up);
    document.addEventListener("pointercancel", handlers.current.up);
  }

  // A single click opens details after a short delay so a double-click can open the editor instead
  function handleEventClick(evt, e) {
    e.stopPropagation();
    if (suppressClick.current || !live.current.onEventClick) return;
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => live.current.onEventClick?.(evt), 600);
  }

  function handleEventDoubleClick(evt, e) {
    e.stopPropagation();
    window.clearTimeout(clickTimer.current);
    if (suppressClick.current) return;
    live.current.onEventEdit?.(evt);
  }

  function navigate(direction) {
    setCurrentDate((prev) => {
      if (view === "month") {
        // Clamp the day so Jan 31 + 1 month lands on Feb 28/29, not in March
        const target = new Date(prev.getFullYear(), prev.getMonth() + direction, 1);
        const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
        target.setDate(Math.min(prev.getDate(), lastDay));
        return target;
      }
      const d = new Date(prev);
      d.setDate(d.getDate() + (view === "week" ? direction * 7 : direction));
      return d;
    });
  }

  function openDay(date) {
    setCurrentDate(date);
    setView("day");
  }

  // ---- header title ----
  let title;
  if (view === "month") {
    title = `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  } else if (view === "week") {
    const weekStart = getStartOfWeek(currentDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    title = `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getDate()} - ${weekEnd.getDate()}, ${weekStart.getFullYear()}`;
  } else {
    title = `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getDate()}, ${currentDate.getFullYear()}`;
  }

  // ---- time grid (week + day) ----
  const gridStart = 0;
  const gridEnd = 23;
  let gridDays = [];
  if (view === "week") {
    const start = getStartOfWeek(currentDate);
    gridDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  } else if (view === "day") {
    gridDays = [currentDate];
  }
  grid.current = { start: gridStart, end: gridEnd };
  const minutesPerSlot = showHalfHours ? 30 : 60;
  const timeSlots = Array.from({ length: (24 * 60) / minutesPerSlot }, (_, i) => i * minutesPerSlot);
  const gridHeight = timeSlots.length * 40;
  const today = new Date();

  function renderTimeEvent(evt) {
    if (!evt.segmentStartTime || !evt.segmentEndTime) return null;

    const startMinutes = timeToMinutes(evt.segmentStartTime);
    const endMinutes = timeToMinutes(evt.segmentEndTime);
    const totalGridMinutes = 24 * 60;
    const top = Math.max(0, ((startMinutes - gridStart * 60) / totalGridMinutes) * 100);
    const height = Math.max(5, ((endMinutes - startMinutes) / totalGridMinutes) * 100);
    const columnCount = evt.overlapColumns || 1;
    const columnWidth = 100 / columnCount;

    return (
      <div
        key={evt.id}
        className={`cal-time-event ${evt.completed ? "completed" : ""} ${evt.isRescheduled ? "rescheduled" : ""}`}
        data-event-id={String(evt.id)}
        title={`${evt.title}. ${onEventEdit ? "Click for details; double-click to edit." : "Click for details."}`}
        style={{
          top: `${top}%`,
          height: `${height}%`,
          left: `calc(${columnWidth * (evt.overlapColumn || 0)}% + 2px)`,
          right: "auto",
          width: `calc(${columnWidth}% - 4px)`,
        }}
        onClick={(e) => handleEventClick(evt, e)}
        onPointerDown={(e) => startEventDrag(evt, e)}
        onDoubleClick={(e) => handleEventDoubleClick(evt, e)}
      >
        <div className="cal-event-title">{evt.title}</div>
        <EventCheckbox evt={evt} onToggle={onEventToggle} />
        <div className="cal-event-time">{formatTime(evt.segmentStartTime)} - {formatTime(evt.segmentEndTime)}</div>
      </div>
    );
  }

  // ---- month grid ----
  function renderMonth() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDaysInMonth = new Date(year, month, 0).getDate();
    const leading = Array.from({ length: firstDayIndex }, (_, i) => prevDaysInMonth - firstDayIndex + 1 + i);
    const trailing = Array.from({ length: (42 - (firstDayIndex + daysInMonth)) % 7 }, (_, i) => i + 1);

    return (
      <div className="skiddio-cal-month-grid">
        {DAYS_OF_WEEK.map((day) => (
          <div key={day} className="skiddio-cal-day-header">{day}</div>
        ))}

        {leading.map((n) => (
          <div key={`prev-${n}`} className="skiddio-cal-cell inactive"><span className="cell-num">{n}</span></div>
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
          const dayEvents = getEventsForDay(events, year, month, day);

          return (
            <div
              key={day}
              className={`skiddio-cal-cell ${isToday ? "today" : ""}`}
              data-date={localDateString(new Date(year, month, day))}
              aria-label={`Double-click to open schedule for ${month + 1}/${day}/${year}`}
              title="Double-click to open this day's schedule"
              onDoubleClick={(e) => {
                if (e.target.closest("button, .cal-event-badge")) return;
                openDay(new Date(year, month, day));
              }}
            >
              <div className="cal-cell-header">
                <span className="cell-num">{day}</span>
                <button
                  className="cal-day-open"
                  type="button"
                  aria-label={`Open full schedule for ${month + 1}/${day}/${year}`}
                  title="Open full day schedule"
                  onClick={(e) => { e.stopPropagation(); openDay(new Date(year, month, day)); }}
                >
                  <span aria-hidden="true">↗</span>
                </button>
              </div>

              <div className="cell-events">
                {dayEvents.slice(0, 2).map((evt) => (
                  <div
                    key={evt.id}
                    className={`cal-event-badge ${evt.completed ? "completed" : ""} ${evt.isRescheduled ? "rescheduled" : ""}`}
                    data-event-id={String(evt.id)}
                    title={`${evt.title} (${formatTime(evt.segmentStartTime)} - ${formatTime(evt.segmentEndTime)}). ${onEventEdit ? "Click for details; double-click to edit." : "Click for details."}`}
                    onClick={(e) => handleEventClick(evt, e)}
                    onPointerDown={(e) => startEventDrag(evt, e)}
                    onDoubleClick={(e) => handleEventDoubleClick(evt, e)}
                  >
                    <EventCheckbox evt={evt} onToggle={onEventToggle} />
                    <span className="cal-event-label">
                      {evt.segmentStartTime === "00:00" && evt.segmentEndTime === "24:00"
                        ? "All day"
                        : `${formatTime(evt.segmentStartTime)}-${formatTime(evt.segmentEndTime)}`} {evt.title}
                    </span>
                  </div>
                ))}

                {dayEvents.length > 2 && (
                  <button
                    type="button"
                    className="cal-day-more"
                    aria-label={`Show all ${dayEvents.length} schedules for ${month + 1}/${day}/${year}`}
                    onClick={(e) => { e.stopPropagation(); openDay(new Date(year, month, day)); }}
                  >
                    +{dayEvents.length - 2} more
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {trailing.map((n) => (
          <div key={`next-${n}`} className="skiddio-cal-cell inactive"><span className="cell-num">{n}</span></div>
        ))}
      </div>
    );
  }

  function renderTimeGrid() {
    const single = view === "day";
    return (
      <div className={`skiddio-cal-time-grid ${single ? "day-view" : ""}`}>
        {!single && (
          <div className="time-grid-header">
            <div />
            {gridDays.map((d) => (
              <div
                key={d.toDateString()}
                className={`time-header-cell ${today.toDateString() === d.toDateString() ? "today" : ""} day-header-open`}
                title="Double-click to open this day"
                onDoubleClick={() => openDay(new Date(d))}
              >
                <strong>{d.toLocaleDateString("en-US", { weekday: "short" })}</strong> <span>{d.getDate()}</span>
              </div>
            ))}
          </div>
        )}

        <div className="time-grid-body">
          <div className="time-labels-col">
            {timeSlots.map((minutes) => {
              const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
              return (
                <div key={minutes} className={`time-label ${minutes % 60 ? "half-hour-label" : ""}`}>
                  {formatTime(time)}
                </div>
              );
            })}
          </div>

          {gridDays.map((d) => (
            <div
              key={d.toDateString()}
              className="time-day-col"
              data-date={localDateString(d)}
              style={{ height: `${gridHeight}px` }}
              title={view === "week" ? "Double-click to open this day" : undefined}
              onDoubleClick={view === "week" ? () => openDay(new Date(d)) : undefined}
            >
              {timeSlots.map((minutes) => (
                <div key={minutes} className={`time-slot ${minutes % 60 ? "half-hour-slot" : ""}`} />
              ))}
              {layoutOverlappingEvents(getEventsForDay(events, d.getFullYear(), d.getMonth(), d.getDate())).map(renderTimeEvent)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderHorizontalDayGrid() {
    const day = gridDays[0];
    const positionedEvents = layoutOverlappingEvents(
      getEventsForDay(events, day.getFullYear(), day.getMonth(), day.getDate()),
    );
    const laneCount = Math.max(1, ...positionedEvents.map((evt) => evt.overlapColumns || 1));

    return (
      <div className="horizontal-day-scroll">
        <div className={`horizontal-day-canvas ${showHalfHours ? "expanded" : ""}`}>
          <div className="horizontal-day-heading">
            {day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </div>
          <div className={`horizontal-time-axis ${showHalfHours ? "expanded" : ""}`}>
            {timeSlots.filter((minutes) => minutes % 60 === 0 || showHalfHours).map((minutes) => (
              <div key={minutes} className={`horizontal-hour-label ${minutes % 60 ? "half-hour-label" : ""}`}>
                {formatTime(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`)}
              </div>
            ))}
          </div>
          <div
            className="time-day-col horizontal-time-day-col"
            data-date={localDateString(day)}
            style={{ height: `${Math.max(112, laneCount * 66 + 16)}px` }}
          >
            {timeSlots.filter((minutes) => minutes % 60 === 0 || showHalfHours).map((minutes) => (
              <div key={minutes} className={`horizontal-hour-line ${minutes % 60 ? "half-hour-line" : ""}`} style={{ left: `${(minutes / 1440) * 100}%` }} />
            ))}
            {positionedEvents.map((evt) => {
              const start = timeToMinutes(evt.segmentStartTime);
              const duration = timeToMinutes(evt.segmentEndTime) - start;
              return (
                <div
                  key={evt.id}
                  className={`cal-time-event horizontal-cal-event ${evt.completed ? "completed" : ""} ${evt.isRescheduled ? "rescheduled" : ""}`}
                  data-event-id={String(evt.id)}
                  title={`${evt.title}. ${onEventEdit ? "Click for details; double-click to edit." : "Click for details."}`}
                  style={{
                    left: `${(start / 1440) * 100}%`,
                    width: `${(duration / 1440) * 100}%`,
                    top: `${(evt.overlapColumn || 0) * 66 + 6}px`,
                  }}
                  onClick={(e) => handleEventClick(evt, e)}
                  onPointerDown={(e) => startEventDrag(evt, e)}
                  onDoubleClick={(e) => handleEventDoubleClick(evt, e)}
                >
                  <div className="cal-event-title">{evt.title}</div>
                  <EventCheckbox evt={evt} onToggle={onEventToggle} />
                  <div className="cal-event-time">{formatTime(evt.segmentStartTime)} - {formatTime(evt.segmentEndTime)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="skiddio-calendar-root">
      <div className="skiddio-cal-header">
        <h3 className="skiddio-cal-title">{title}</h3>

        <div className="skiddio-cal-nav-group">
          <button type="button" className="btn btn-small btn-cal-nav" aria-label="Previous" onClick={() => navigate(-1)}>‹</button>
          <button
            type="button"
            className="btn btn-small btn-cal-nav"
            title="Go to today"
            aria-label="Go to today"
            onClick={() => setCurrentDate(new Date())}
          >
            {currentDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </button>
          <button type="button" className="btn btn-small btn-cal-nav" aria-label="Next" onClick={() => navigate(1)}>›</button>
        </div>

        {onCreateEvent && (
          <button
            type="button"
            className="btn btn-small calendar-add-button"
            onClick={() => onCreateEvent(localDateString(currentDate))}
          >
            <span aria-hidden="true">+</span> Add schedule
          </button>
        )}
        {onShare && (
          <button type="button" className="btn btn-small calendar-share-button" onClick={onShare}>
            Share
          </button>
        )}

        <div className="skiddio-cal-view-group">
          {VIEWS.map((mode) => (
            <button key={mode} type="button" className={`btn-cal-view ${view === mode ? "active" : ""}`} onClick={() => setView(mode)}>
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
          {view === "day" && (
            <>
              <button
                type="button"
                className={`btn-cal-view ${dayOrientation === "vertical" ? "active" : ""}`}
                aria-pressed={dayOrientation === "vertical"}
                onClick={() => setDayOrientation("vertical")}
              >
                Vertical
              </button>
              <button
                type="button"
                className={`btn-cal-view ${dayOrientation === "horizontal" ? "active" : ""}`}
                aria-pressed={dayOrientation === "horizontal"}
                onClick={() => setDayOrientation("horizontal")}
              >
                Horizontal
              </button>
            </>
          )}
          {view !== "month" && (
            <button
              type="button"
              className={`btn-cal-view ${showHalfHours ? "active" : ""}`}
              aria-pressed={showHalfHours}
              onClick={() => setShowHalfHours((expanded) => !expanded)}
            >
              {showHalfHours ? "Collapse hours" : "Expand hours"}
            </button>
          )}
        </div>
      </div>

      <div className="skiddio-cal-body">
        {view === "month"
          ? renderMonth()
          : view === "day" && dayOrientation === "horizontal"
            ? renderHorizontalDayGrid()
            : renderTimeGrid()}
      </div>
    </div>
  );
}
