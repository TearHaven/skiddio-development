"use client";

import { useEffect, useRef } from "react";
import { formatScheduleDateRange, formatTime } from "@/lib/tasks";

// `request` describes an overnight confirmation or a schedule overlap; null otherwise.
export default function ConflictDialog({ request, onChoice }) {
  const dialogRef = useRef(null);
  const isOvernight = request?.type === "overnight";
  const isOverlap = request?.type === "overlap";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (request && !dialog.open) dialog.showModal();
    else if (!request && dialog.open) dialog.close();
  }, [request]);

  return (
    <dialog
      ref={dialogRef}
      id="schedule-conflict-dialog"
      className="calendar-dialog conflict-dialog"
      onCancel={(e) => { e.preventDefault(); onChoice(false); }}
    >
      <div className="conflict-dialog-mark" aria-hidden="true">{isOvernight ? "↗" : "↔"}</div>
      <p className="conflict-eyebrow">{isOvernight ? "Overnight schedule" : "Schedule overlap"}</p>
      <h2>{isOvernight ? "Continue into the next day?" : "Keep overlapping schedules?"}</h2>
      {isOvernight && (
        <p className="conflict-summary">
          “{request.schedule.title}” ends at {formatTime(request.schedule.endTime)}. Set its end date to{" "}
          {formatScheduleDateRange(request.endDate)}?
        </p>
      )}
      {isOverlap && (
        <>
          <p className="conflict-summary">
            “{request.schedule.title}” overlaps {request.overlaps.length === 1 ? "this schedule" : `${request.overlaps.length} schedules`}.
            You can keep both, or go back and change the time.
          </p>
          <p className="conflict-summary">
            Proposed: {formatScheduleDateRange(request.schedule.date, request.schedule.endDate)} ·{" "}
            {formatTime(request.schedule.startTime)} - {formatTime(request.schedule.endTime)}
          </p>
          <ul className="conflict-overlap-list">
            {request.overlaps.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <span>
                  {formatScheduleDateRange(task.date, task.endDate)} · {formatTime(task.startTime)} - {formatTime(task.endTime)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="conflict-options">
        <button className="conflict-option" type="button" onClick={() => onChoice(true)}>
          <span className="conflict-option-icon" aria-hidden="true">✓</span>
          <span>
            <strong>{isOvernight ? "Use the next day" : "Keep both schedules"}</strong>
            <small>{isOvernight ? "Move the end date forward one day." : "Save this schedule and keep the overlap."}</small>
          </span>
        </button>
        <button className="conflict-option" type="button" onClick={() => onChoice(false)}>
          <span className="conflict-option-icon" aria-hidden="true">↩</span>
          <span>
            <strong>{isOvernight ? "Change the end time" : "Change the schedule"}</strong>
            <small>{isOvernight ? "Return to the form without saving." : "Cancel this change and adjust the schedule instead."}</small>
          </span>
        </button>
      </div>
    </dialog>
  );
}
