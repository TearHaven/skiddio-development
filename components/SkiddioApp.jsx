"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import AutoRescheduler from "@/lib/rescheduler";
import {
  addDaysToDate,
  dateString,
  localDateString,
  schedulesOverlap,
  taskPlacement,
  toTask,
  validateScheduleRange,
} from "@/lib/tasks";
import useTheme from "@/hooks/useTheme";
import AuthCard from "./AuthCard";
import Sidebar from "./Sidebar";
import { ChecklistSection, SummaryCard } from "./ChecklistView";
import SkiddioCalendar from "./SkiddioCalendar";
import NotesView from "./NotesView";
import SettingsModal from "./SettingsModal";
import TaskEditDialog from "./TaskEditDialog";
import ScheduleDetailsDialog from "./ScheduleDetailsDialog";
import ConflictDialog from "./ConflictDialog";
import CalendarShareDialog from "./CalendarShareDialog";

const DEFAULT_SETTINGS = { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 15 };
const VIEW_TITLES = { checklist: "Today's Tasks", calendar: "Schedule Calendar", notes: "Notes" };
const MAX_SCHEDULE_DAYS = 7;

function taskDatabaseErrorMessage(error) {
  const message = error?.message || String(error);
  if (/end_date/i.test(message) && /(column|schema cache)/i.test(message)) {
    return "The Supabase tasks table needs the schedule migration. Run supabase/migrations/20261115_add_task_end_date.sql in the Supabase SQL Editor, then reload the app.";
  }
  return message;
}

export default function SkiddioApp() {
  const { theme, toggleTheme } = useTheme();

  const [status, setStatus] = useState("loading"); // loading | signedOut | signedIn
  const [sessionError, setSessionError] = useState("");
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [view, setView] = useState("checklist");
  const [notice, setNotice] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [detailsTaskId, setDetailsTaskId] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [calendarFocus, setCalendarFocus] = useState(null);
  const [calendarShareOpen, setCalendarShareOpen] = useState(false);

  // Always-current copies for async code (so a slow request never reads stale state)
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const userIdRef = useRef(null);

  const rescheduler = useMemo(() => new AutoRescheduler(settings), [settings]);

  // ---------- data loading ----------
  async function loadTasks(userId) {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .order("task_date")
      .order("start_time");
    if (error) throw error;
    if (userIdRef.current !== userId) return;
    setTasks(data.map(toTask));
  }

  async function loadSettings(userId) {
    const { data, error } = await supabase
      .from("user_settings")
      .select("day_start, day_end, buffer_minutes")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (userIdRef.current !== userId) return;

    setSettings(data
      ? { dayStart: data.day_start.slice(0, 5), dayEnd: data.day_end.slice(0, 5), bufferMinutes: data.buffer_minutes }
      : DEFAULT_SETTINGS);
  }

  async function activateUser(nextUser) {
    if (userIdRef.current === nextUser.id) return;
    userIdRef.current = nextUser.id;
    setUser(nextUser);
    setTasks([]);
    setNotice(null);
    setStatus("signedIn");

    try {
      await Promise.all([loadTasks(nextUser.id), loadSettings(nextUser.id)]);
    } catch (error) {
      if (userIdRef.current === nextUser.id) alert(`Could not load your Supabase data: ${error.message}`);
    }
  }

  function deactivateUser() {
    userIdRef.current = null;
    setUser(null);
    setTasks([]);
    setNotice(null);
    setStatus("signedOut");
  }

  // ---------- session ----------
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        deactivateUser();
        return;
      }
      if (session?.user) {
        // Defer so we never call Supabase from inside its own auth callback
        setTimeout(() => {
          activateUser(session.user).catch((error) => alert(`Could not load your Supabase data: ${error.message}`));
        }, 0);
      }
    });

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error) {
          setSessionError(`Could not restore your session: ${error.message}`);
          setStatus("signedOut");
        } else if (data.session?.user) {
          return activateUser(data.session.user);
        } else {
          setStatus("signedOut");
        }
      })
      .catch((error) => {
        setSessionError(`Could not restore your session: ${error.message}`);
        setStatus("signedOut");
      });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      deactivateUser();
    } catch (error) {
      alert(`Could not sign out: ${error.message}`);
    }
  }

  // ---------- tasks ----------
  function requestScheduleConfirmation(request) {
    return new Promise((resolve) => setConflict({ ...request, resolve }));
  }

  async function addTask(values) {
    const userId = userIdRef.current;
    if (!userId) return false;

    const schedule = { ...values, endDate: values.endDate || values.date };
    if (typeof schedule.title !== "string" || !schedule.title.trim()) return "Enter a task title.";
    if (!schedule.date || !schedule.endDate || !schedule.startTime || !schedule.endTime) {
      return "Choose start and end dates and times.";
    }

    if (schedule.endDate === schedule.date && schedule.endTime <= schedule.startTime) {
      const endDate = addDaysToDate(schedule.date, 1);
      const confirmed = await requestScheduleConfirmation({ type: "overnight", schedule, endDate });
      if (!confirmed) return false;
      schedule.endDate = endDate;
    }

    const validationError = validateScheduleRange(schedule, MAX_SCHEDULE_DAYS);
    if (validationError) return validationError;

    const overlaps = tasksRef.current.filter((task) => schedulesOverlap(schedule, task));
    if (overlaps.length) {
      const confirmed = await requestScheduleConfirmation({ type: "overlap", schedule, overlaps });
      if (!confirmed) return false;
    }

    try {
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          title: schedule.title.trim(),
          start_time: schedule.startTime,
          end_time: schedule.endTime,
          task_date: schedule.date,
          end_date: schedule.endDate,
          note: schedule.note,
        })
        .select()
        .single();
      if (error) throw error;
      if (userIdRef.current !== userId) return false;
      setTasks((prev) => [...prev, toTask(data)]);
      return true;
    } catch (error) {
      alert(`Could not add task: ${taskDatabaseErrorMessage(error)}`);
      return false;
    }
  }

  async function updateTaskCompletion(evt, completed) {
    const userId = userIdRef.current;
    if (!userId) return;
    const task = tasksRef.current.find((item) => String(item.id) === String(evt.id));
    if (!task || task.completed === completed) return;

    const previousValue = task.completed;
    const setCompleted = (value) => setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: value } : t)));
    setCompleted(completed);

    try {
      const { data, error } = await supabase
        .from("tasks")
        .update({ completed })
        .eq("id", task.id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();
      if (error || !data) throw new Error(taskDatabaseErrorMessage(error || new Error("The task was not found for this account.")));
    } catch (error) {
      if (userIdRef.current !== userId) return;
      setCompleted(previousValue);
      alert(`Could not update task: ${error.message}`);
    }
  }

  async function saveTaskEdit(task, values) {
    const userId = userIdRef.current;
    if (!userId) return;

    const schedule = { ...values, endDate: values.endDate || values.date };
    if (schedule.endDate === schedule.date && schedule.endTime <= schedule.startTime) {
      const endDate = addDaysToDate(schedule.date, 1);
      const confirmed = await requestScheduleConfirmation({ type: "overnight", schedule, endDate });
      if (!confirmed) return false;
      schedule.endDate = endDate;
    }

    const validationError = validateScheduleRange(schedule, MAX_SCHEDULE_DAYS);
    if (validationError) throw new Error(validationError);

    const overlaps = tasksRef.current.filter((item) =>
      String(item.id) !== String(task.id) && schedulesOverlap(schedule, item));
    if (overlaps.length) {
      const confirmed = await requestScheduleConfirmation({ type: "overlap", schedule, overlaps });
      if (!confirmed) return false;
    }

    const { data, error } = await supabase
      .from("tasks")
      .update({
        title: schedule.title,
        task_date: schedule.date,
        end_date: schedule.endDate,
        start_time: schedule.startTime,
        end_time: schedule.endTime,
        note: schedule.note,
      })
      .eq("id", task.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error || !data) throw new Error(error?.message || "The task was not found for this account.");
    if (userIdRef.current !== userId) return;

    setTasks((prev) => prev.map((t) => (t.id === task.id
      ? {
        ...t,
        title: schedule.title,
        date: `${schedule.date}T00:00:00`,
        endDate: `${schedule.endDate}T00:00:00`,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        note: schedule.note,
      }
      : t)));
    setCalendarFocus(new Date(`${schedule.date}T00:00:00`));
    setEditingTaskId(null);
    return true;
  }

  // ---------- calendar drag & drop ----------
  function answerConflict(choice) {
    conflict?.resolve(choice);
    setConflict(null);
  }

  async function updateTaskPlacement(task, placement, userId) {
    const { data, error } = await supabase
      .from("tasks")
      .update({
        task_date: placement.date,
        end_date: placement.endDate,
        start_time: placement.startTime,
        end_time: placement.endTime,
      })
      .eq("id", task.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error || !data) throw new Error(taskDatabaseErrorMessage(error || new Error("A task was not found for this account.")));
  }

  async function handleScheduleDrop(evt, placement) {
    const userId = userIdRef.current;
    if (!userId) return;

    const current = tasksRef.current;
    const moving = current.find((task) => String(task.id) === String(evt.id));
    if (!moving) return;

    const validationError = validateScheduleRange(placement, MAX_SCHEDULE_DAYS);
    if (validationError) {
      alert(validationError);
      return;
    }

    const overlaps = current.filter((task) =>
      String(task.id) !== String(moving.id) && schedulesOverlap(placement, task));
    if (overlaps.length) {
      const confirmed = await requestScheduleConfirmation({
        type: "overlap",
        schedule: { ...placement, title: moving.title },
        overlaps,
      });
      if (!confirmed) return;
    }

    try {
      await updateTaskPlacement(moving, placement, userId);

      if (userIdRef.current !== userId) return;

      setTasks((prev) => prev.map((t) => (t.id === moving.id
        ? {
          ...t,
          date: `${placement.date}T00:00:00`,
          endDate: `${placement.endDate}T00:00:00`,
          startTime: placement.startTime,
          endTime: placement.endTime,
        }
        : t)));
    } catch (error) {
      if (userIdRef.current === userId) alert(`Could not move schedule: ${taskDatabaseErrorMessage(error)}`);
    }
  }

  // ---------- rescheduler ----------
  async function reschedule() {
    const userId = userIdRef.current;
    if (!userId) return;

    const current = tasksRef.current;
    const today = localDateString();
    const todayTasks = current
      .filter((task) => dateString(task.date) <= today && dateString(task.endDate) >= today)
      .map((task) => ({
        ...task,
        startTime: dateString(task.date) < today ? "00:00" : task.startTime,
        endTime: dateString(task.endDate) > today ? "24:00" : task.endTime,
      }));
    const result = rescheduler.rescheduleOverdueTasks(todayTasks);
    const updatedById = new Map(result.updatedTasks
      .filter((task) => dateString(task.date) === today && dateString(task.endDate) === today)
      .map((task) => [task.id, task]));
    const updatedTasks = current.map((task) => updatedById.get(task.id) || task);
    const changedTasks = updatedTasks.filter((task) => {
      const original = current.find((c) => c.id === task.id);
      return original && (original.startTime !== task.startTime || original.endTime !== task.endTime);
    });

    try {
      for (const task of changedTasks) {
        const { data, error } = await supabase
          .from("tasks")
          .update({
            start_time: task.startTime,
            end_time: task.endTime,
            is_rescheduled: task.isRescheduled,
            reschedule_reason: task.rescheduleReason || null,
          })
          .eq("id", task.id)
          .eq("user_id", userId)
          .select("id")
          .maybeSingle();
        if (error || !data) throw new Error(error?.message || "A task was not found for this account.");
      }
      if (userIdRef.current !== userId) return;
      setTasks(updatedTasks);
    } catch (error) {
      if (userIdRef.current !== userId) return;
      try {
        await loadTasks(userId);
      } catch (reloadError) {
        alert(`Could not save rescheduled tasks: ${error.message}. Reload also failed: ${reloadError.message}`);
        setNotice("Rescheduling failed; task changes could not be saved.");
        return;
      }
      alert(`Could not save rescheduled tasks: ${error.message}`);
      setNotice("Rescheduling failed; task changes could not be saved.");
      return;
    }

    setNotice(result.rescheduledCount > 0 && changedTasks.length === result.rescheduledCount
      ? `Auto-rescheduled ${result.rescheduledCount} overdue task(s) into available slots.`
      : "All tasks are currently on track!");
  }

  // ---------- render ----------
  if (status === "loading") return null;

  if (status === "signedOut") {
    return <AuthCard theme={theme} onToggleTheme={toggleTheme} onSignedIn={activateUser} initialError={sessionError} />;
  }

  const today = localDateString();
  const overdueCount = rescheduler.getOverdueTasks(tasks.filter((task) =>
    dateString(task.date) === today && dateString(task.endDate) === today)).length;
  const editingTask = tasks.find((task) => task.id === editingTaskId) || null;
  const detailsTask = tasks.find((task) => task.id === detailsTaskId) || null;

  return (
    <>
      <div className="dashboard-wrapper">
        <Sidebar
          view={view}
          onViewChange={setView}
          onOpenSettings={() => setSettingsOpen(true)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
        />

        <main className="main-content">
          <header className="top-bar">
            <h2>{VIEW_TITLES[view]}</h2>
            <button type="button" className="btn btn-ai" onClick={reschedule}>Rescheduler</button>
          </header>

          <div className={`dashboard-grid ${view === "checklist" ? "" : "hidden"}`}>
            <ChecklistSection tasks={tasks} onAddTask={addTask} onToggleTask={updateTaskCompletion} />
            <SummaryCard total={tasks.length} overdue={overdueCount} notice={notice} />
          </div>

          {/* Kept mounted (just hidden) so each view remembers where you left off */}
          <div className={`card ${view === "calendar" ? "" : "hidden"}`}>
            <SkiddioCalendar
              events={tasks}
              focusDate={calendarFocus}
              onEventClick={(evt) => setDetailsTaskId(evt.id)}
              onEventEdit={(evt) => setEditingTaskId(evt.id)}
              onEventToggle={updateTaskCompletion}
              onEventDrop={handleScheduleDrop}
              onShare={() => setCalendarShareOpen(true)}
            />
          </div>

          <NotesView key={user.id} userId={user.id} active={view === "notes"} />
        </main>
      </div>

      {settingsOpen && (
        <SettingsModal settings={settings} userId={user.id} onSaved={setSettings} onClose={() => setSettingsOpen(false)} />
      )}

      <TaskEditDialog task={editingTask} onSave={saveTaskEdit} onClose={() => setEditingTaskId(null)} />
      <ScheduleDetailsDialog
        task={detailsTask}
        onClose={() => setDetailsTaskId(null)}
        onEdit={(task) => { setDetailsTaskId(null); setEditingTaskId(task.id); }}
        onToggleComplete={updateTaskCompletion}
      />
      {calendarShareOpen && (
        <CalendarShareDialog userId={user.id} onClose={() => setCalendarShareOpen(false)} />
      )}
      <ConflictDialog request={conflict} onChoice={answerConflict} />
    </>
  );
}
