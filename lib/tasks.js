// Small helpers shared by the dashboard and the calendar.

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateString(value) {
  if (typeof value !== "string" || !value) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : localDateString(new Date(value));
}

export function addDaysToDate(date, days) {
  const [year, month, day] = dateString(date).split("-").map(Number);
  const result = new Date(year, month - 1, day);
  result.setDate(result.getDate() + days);
  return localDateString(result);
}

export function formatScheduleDateRange(startDate, endDate = startDate) {
  const start = dateString(startDate);
  const end = dateString(endDate || startDate);
  const format = (value) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return start === end ? format(start) : `${format(start)} - ${format(end)}`;
}

function dateOrdinal(date) {
  const [year, month, day] = dateString(date).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function dateFromOrdinal(ordinal) {
  return new Date(ordinal * 86400000).toISOString().slice(0, 10);
}

export function validateScheduleRange({ date, endDate, startTime, endTime }, maxCalendarDays = 7) {
  const startDate = dateString(date);
  const finalDate = dateString(endDate || date);
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const validTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || "");

  if (!validDate(startDate) || !validDate(finalDate) || !validTime(startTime) || !validTime(endTime)) {
    return "Choose valid start and end dates and times.";
  }
  if (finalDate < startDate) return "The end date must be on or after the start date.";

  const calendarDays = dateOrdinal(finalDate) - dateOrdinal(startDate) + 1;
  if (calendarDays > maxCalendarDays) return `A schedule can span at most ${maxCalendarDays} calendar days.`;
  if (calendarDays === 1 && endTime <= startTime) {
    return "The end time must be after the start time. To continue overnight, confirm the following day.";
  }
  return "";
}

export function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function schedulesOverlap(first, second) {
  const bounds = (schedule) => {
    const startDate = dateString(schedule.date || schedule.task_date);
    const endDate = dateString(schedule.endDate || schedule.end_date || schedule.date || schedule.task_date);
    if (!startDate || !endDate || !schedule.startTime || !schedule.endTime) {
      throw new Error("A schedule needs start/end dates and times to check for overlap.");
    }

    return {
      start: dateOrdinal(startDate) * 1440 + timeToMinutes(schedule.startTime),
      end: dateOrdinal(endDate) * 1440 + timeToMinutes(schedule.endTime),
    };
  };

  const a = bounds(first);
  const b = bounds(second);
  return a.start < b.end && b.start < a.end;
}

export function shiftScheduleByMinutes(schedule, deltaMinutes) {
  const placement = taskPlacement(schedule);
  const start = dateOrdinal(placement.date) * 1440 + timeToMinutes(placement.startTime) + deltaMinutes;
  const end = dateOrdinal(placement.endDate) * 1440 + timeToMinutes(placement.endTime) + deltaMinutes;
  const startDay = Math.floor(start / 1440);
  const endDay = Math.floor(end / 1440);

  return {
    date: dateFromOrdinal(startDay),
    endDate: dateFromOrdinal(endDay),
    startTime: minutesToTime(start - startDay * 1440),
    endTime: minutesToTime(end - endDay * 1440),
  };
}

export function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function formatTime(time) {
  if (!time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  const normalizedHour = hours % 24;
  const period = normalizedHour >= 12 ? "PM" : "AM";
  const displayHour = normalizedHour % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

// Database row -> task used by the UI
export function toTask(row) {
  const startDate = row.task_date.slice(0, 10);
  const endDate = (row.end_date || row.task_date).slice(0, 10);
  return {
    id: row.id,
    title: row.title,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    date: `${startDate}T00:00:00`,
    endDate: `${endDate}T00:00:00`,
    completed: row.completed,
    isRescheduled: row.is_rescheduled,
    rescheduleReason: row.reschedule_reason,
    note: row.note || "",
  };
}

export function taskPlacement(task) {
  const date = dateString(task.date || task.task_date);
  const endDate = dateString(task.endDate || task.end_date || task.date || task.task_date);
  return {
    date,
    endDate,
    startTime: task.startTime,
    endTime: task.endTime,
  };
}
