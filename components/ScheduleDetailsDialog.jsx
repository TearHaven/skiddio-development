"use client";

import { useEffect, useRef, useState } from "react";
import { formatScheduleDateRange, formatTime, taskPlacement } from "@/lib/tasks";

// `task` is the schedule being viewed (null = dialog closed)
export default function ScheduleDetailsDialog({ task, onClose, onEdit, onToggleComplete, canEdit = true }) {
  const dialogRef = useRef(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (task && !dialog.open) dialog.showModal();
    else if (!task && dialog.open) dialog.close();
  }, [task]);

  const placement = task ? taskPlacement(task) : null;
  const status = task?.completed ? "Completed" : task?.isRescheduled ? "Rescheduled" : "Scheduled";

  async function toggle() {
    setBusy(true);
    try {
      await onToggleComplete(task, !task.completed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} id="schedule-details-dialog" className="calendar-dialog schedule-details-dialog" aria-labelledby="schedule-details-title" onClose={onClose}>
      <div className="schedule-details-heading">
        <div className="schedule-details-mark" aria-hidden="true">◷</div>
        <div>
          <p className="schedule-details-eyebrow">Schedule details</p>
          <h2 id="schedule-details-title">{task?.title}</h2>
        </div>
        <span className={`schedule-status ${task?.completed ? "is-complete" : ""} ${task?.isRescheduled ? "is-rescheduled" : ""}`}>
          {task ? status : ""}
        </span>
      </div>

      <div className="schedule-details-grid">
        <div className="schedule-detail-item">
          <span className="schedule-detail-icon" aria-hidden="true">▦</span>
          <div>
            <span className="schedule-detail-label">Date</span>
            <strong>
              {placement ? formatScheduleDateRange(placement.date, placement.endDate) : ""}
            </strong>
          </div>
        </div>
        <div className="schedule-detail-item">
          <span className="schedule-detail-icon" aria-hidden="true">◷</span>
          <div>
            <span className="schedule-detail-label">Time</span>
            <strong>{task ? `${formatTime(task.startTime)} – ${formatTime(task.endTime)}` : ""}</strong>
          </div>
        </div>
      </div>

      {task?.note && <p className="schedule-details-note"><strong>Note: </strong>{task.note}</p>}
      {task?.rescheduleReason && <p className="schedule-details-note">Rescheduled: {task.rescheduleReason}</p>}

      <div className="calendar-dialog-actions">
        <button className="btn calendar-btn-secondary" type="button" onClick={onClose}>Close</button>
        {canEdit && (
          <>
            <button className="btn calendar-btn-secondary" type="button" disabled={busy} onClick={toggle}>
              {task?.completed ? "Mark as upcoming" : "Mark complete"}
            </button>
            <button className="btn btn-primary" type="button" onClick={() => onEdit(task)}>Edit schedule</button>
          </>
        )}
      </div>
    </dialog>
  );
}
