"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDaysToDate,
  dateString,
  localDateString,
  schedulesOverlap,
  toTask,
  validateScheduleRange,
} from "@/lib/tasks";
import { supabase } from "@/lib/supabase";
import { calendarSharingErrorMessage } from "@/lib/calendarSharing";
import SkiddioCalendar from "./SkiddioCalendar";
import TaskEditDialog from "./TaskEditDialog";
import ScheduleDetailsDialog from "./ScheduleDetailsDialog";
import ConflictDialog from "./ConflictDialog";

export default function SharedCalendarPage({ token }) {
  const [status, setStatus] = useState("loading");
  const [tasks, setTasks] = useState([]);
  const [permission, setPermission] = useState("view");
  const [pageError, setPageError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [creatingDate, setCreatingDate] = useState("");
  const [detailsTaskId, setDetailsTaskId] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [calendarFocus, setCalendarFocus] = useState(null);
  const canEdit = permission === "edit";
  const isEditingRef = useRef(false);
  isEditingRef.current = Boolean(editingTaskId || creatingDate || detailsTaskId);

  useEffect(() => {
    let active = true;

    async function loadCalendar() {
      setRefreshing(true);
      try {
        const { data, error } = await supabase.rpc("get_shared_calendar", { p_token: token });
        if (error) throw error;
        if (!active) return;
        if (!data || !Array.isArray(data.events)) {
          setTasks([]);
          setStatus("unavailable");
          return;
        }

        if (!isEditingRef.current) setTasks(data.events.map(toTask));
        setPermission(data.permission);
        setPageError("");
        setStatus("ready");
      } catch (error) {
        if (!active) return;
        setPageError(`Could not load this shared calendar: ${calendarSharingErrorMessage(error)}`);
        setStatus((current) => current === "ready" ? current : "error");
      } finally {
        if (active) setRefreshing(false);
      }
    }

    loadCalendar();
    const interval = window.setInterval(loadCalendar, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [token, refreshKey]);

  function requestScheduleConfirmation(request) {
    return new Promise((resolve) => setConflict({ ...request, resolve }));
  }

  function answerConflict(choice) {
    conflict?.resolve(choice);
    setConflict(null);
  }

  async function saveSharedTask(task, values) {
    if (!canEdit) throw new Error("This shared calendar is view-only.");

    const schedule = { ...values, endDate: values.endDate || values.date };
    if (schedule.endDate === schedule.date && schedule.endTime <= schedule.startTime) {
      const endDate = addDaysToDate(schedule.date, 1);
      const confirmed = await requestScheduleConfirmation({ type: "overnight", schedule, endDate });
      if (!confirmed) return false;
      schedule.endDate = endDate;
    }

    const validationError = validateScheduleRange(schedule, 7);
    if (validationError) throw new Error(validationError);

    const overlaps = tasks.filter((item) =>
      String(item.id) !== String(task?.id) && schedulesOverlap(schedule, item));
    if (overlaps.length) {
      const confirmed = await requestScheduleConfirmation({ type: "overlap", schedule, overlaps });
      if (!confirmed) return false;
    }

    const { data, error } = await supabase.rpc("save_shared_task", {
      p_token: token,
      p_task_id: task?.id || null,
      p_title: schedule.title,
      p_task_date: schedule.date,
      p_end_date: schedule.endDate,
      p_start_time: schedule.startTime,
      p_end_time: schedule.endTime,
      p_note: schedule.note || null,
    });
    if (error) throw new Error(calendarSharingErrorMessage(error));

    const savedTask = toTask(data);
    setTasks((current) => task?.id
      ? current.map((item) => String(item.id) === String(task.id) ? savedTask : item)
      : [...current, savedTask]);
    setCalendarFocus(new Date(`${schedule.date}T00:00:00`));
    setEditingTaskId(null);
    setCreatingDate("");
    setDetailsTaskId(null);
    setPageError("");
    return true;
  }

  async function handleDrop(event, placement) {
    const task = tasks.find((item) => String(item.id) === String(event.id));
    if (!task) return;
    try {
      await saveSharedTask(task, {
        title: task.title,
        ...placement,
        note: task.note,
      });
    } catch (error) {
      setPageError(`Could not move schedule: ${calendarSharingErrorMessage(error)}`);
    }
  }

  async function toggleCompletion(task, completed) {
    try {
      const { error } = await supabase.rpc("set_shared_task_completion", {
        p_token: token,
        p_task_id: task.id,
        p_completed: completed,
      });
      if (error) throw error;
      setTasks((current) => current.map((item) =>
        String(item.id) === String(task.id) ? { ...item, completed } : item));
      setPageError("");
    } catch (error) {
      setPageError(`Could not update schedule: ${calendarSharingErrorMessage(error)}`);
    }
  }

  const editingTask = tasks.find((task) => String(task.id) === String(editingTaskId)) || null;
  const taskDialogTask = useMemo(() => editingTask || (creatingDate
    ? {
      id: null,
      title: "",
      date: `${creatingDate}T00:00:00`,
      endDate: `${creatingDate}T00:00:00`,
      startTime: "",
      endTime: "",
      note: "",
    }
    : null), [editingTask, creatingDate]);
  const detailsTask = tasks.find((task) => String(task.id) === String(detailsTaskId)) || null;

  if (status === "loading" || status === "error") {
    return (
      <main className="shared-calendar-page">
        <header className="shared-calendar-brand"><span>SKIDDIO</span><span>Shared calendar</span></header>
        <section className="card shared-calendar-message" role={status === "error" ? "alert" : undefined}>
          {status === "loading" ? "Loading shared calendar…" : pageError}
        </section>
      </main>
    );
  }

  if (status === "unavailable") {
    return (
      <main className="shared-calendar-page">
        <header className="shared-calendar-brand"><span>SKIDDIO</span><span>Shared calendar</span></header>
        <section className="card shared-calendar-message" role="status">
          This calendar link is invalid or has been revoked.
        </section>
      </main>
    );
  }

  return (
    <main className="shared-calendar-page">
      <header className="shared-calendar-brand">
        <span>SKIDDIO</span>
        <span>Shared calendar</span>
        <span className={`shared-calendar-role ${canEdit ? "is-editor" : ""}`}>
          {canEdit ? "Editor access" : "Viewer access"}
        </span>
      </header>
      {pageError && <p className="shared-calendar-error" role="alert">{pageError}</p>}
      <section className="card shared-calendar-card">
        <div className="shared-calendar-toolbar">
          <div>
            <h1>Calendar</h1>
            <p>{canEdit ? "You can add, edit, move, and complete schedules." : "You can view schedules and their notes."}</p>
          </div>
          <button
            type="button"
            className="btn calendar-btn-secondary"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <SkiddioCalendar
          events={tasks}
          focusDate={calendarFocus}
          onEventClick={(event) => setDetailsTaskId(event.id)}
          onEventEdit={canEdit ? (event) => setEditingTaskId(event.id) : undefined}
          onEventToggle={canEdit ? toggleCompletion : undefined}
          onEventDrop={canEdit ? handleDrop : undefined}
          onCreateEvent={canEdit ? (date) => setCreatingDate(dateString(date) || localDateString()) : undefined}
        />
      </section>

      <TaskEditDialog
        task={taskDialogTask}
        onSave={saveSharedTask}
        onClose={() => { setEditingTaskId(null); setCreatingDate(""); }}
      />
      <ScheduleDetailsDialog
        task={detailsTask}
        canEdit={canEdit}
        onClose={() => setDetailsTaskId(null)}
        onEdit={(task) => { setDetailsTaskId(null); setEditingTaskId(task.id); }}
        onToggleComplete={toggleCompletion}
      />
      <ConflictDialog request={conflict} onChoice={answerConflict} />
    </main>
  );
}
