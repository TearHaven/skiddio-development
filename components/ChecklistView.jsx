"use client";

import { useState } from "react";
import { addDaysToDate, formatScheduleDateRange, formatTime, localDateString, taskPlacement } from "@/lib/tasks";

export function ChecklistSection({ tasks, onAddTask, onToggleTask }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => localDateString());
  const [endDate, setEndDate] = useState(() => localDateString());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const added = await onAddTask({ title, date, endDate, startTime, endTime, note: note.trim() });
      if (added === true) {
        setTitle("");
        setDate(localDateString());
        setEndDate(localDateString());
        setStartTime("");
        setEndTime("");
        setNote("");
      } else if (typeof added === "string") {
        setError(added);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card checklist-section">
      <h3>Active Checklist</h3>

      <form className="task-input-group" onSubmit={handleSubmit}>
        <input type="text" id="task-title" placeholder="Add a new task..." required value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="task-date-field">
          <label htmlFor="task-date">Start date</label>
          <input
            type="date"
            id="task-date"
            required
            value={date}
            onChange={(e) => {
              const nextDate = e.target.value;
              setDate(nextDate);
              setEndDate((current) => current === date ? nextDate : current);
            }}
          />
        </div>
        <div className="task-date-field">
          <label htmlFor="task-end-date">End date</label>
          <input
            type="date"
            id="task-end-date"
            required
            min={date}
            max={date ? addDaysToDate(date, 6) : undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <input type="time" id="task-start-time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        <input type="time" id="task-end-time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        <textarea id="task-note" placeholder="Add a note (optional)..." maxLength={500} aria-label="Task note" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="calendar-dialog-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-small" disabled={busy}>Add Task</button>
      </form>

      <ul className="task-list">
        {tasks.map((task) => {
          const placement = taskPlacement(task);
          return (
            <li key={task.id} className={`task-item ${task.isRescheduled ? "rescheduled" : ""}`}>
              <div>
                <strong style={task.completed ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>{task.title}</strong>
                {task.note && <div className="task-note">{task.note}</div>}
                <div className="task-meta">
                  {formatScheduleDateRange(placement.date, placement.endDate)} | {formatTime(task.startTime)} - {formatTime(task.endTime)}
                  {task.rescheduleReason ? ` | ${task.rescheduleReason}` : ""}
                </div>
              </div>
              <input
                type="checkbox"
                checked={Boolean(task.completed)}
                aria-label={`Mark ${task.title} completed`}
                onChange={(e) => onToggleTask(task, e.target.checked)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SummaryCard({ total, overdue, notice }) {
  return (
    <section className="card summary-section">
      <h3>Unified Hub Summary</h3>
      <div className="summary-stat">
        <span className="stat-number">{total}</span>
        <span className="stat-label">Total Tasks</span>
      </div>
      <div className="summary-stat">
        <span className="stat-number">{overdue}</span>
        <span className="stat-label">Needs Rescheduling</span>
      </div>
      {notice && (
        <div className="ai-notice-box">
          <strong>Suggestion:</strong>
          <p>{notice}</p>
        </div>
      )}
    </section>
  );
}
