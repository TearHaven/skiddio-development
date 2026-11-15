import assert from "node:assert/strict";
import test from "node:test";
import {
  schedulesOverlap,
  shiftScheduleByMinutes,
  validateScheduleRange,
} from "./tasks.js";

test("schedule range accepts overnight times only when the end date advances", () => {
  assert.equal(validateScheduleRange({
    date: "2026-11-19",
    endDate: "2026-11-19",
    startTime: "23:44",
    endTime: "00:07",
  }), "The end time must be after the start time. To continue overnight, confirm the following day.");

  assert.equal(validateScheduleRange({
    date: "2026-11-19",
    endDate: "2026-11-20",
    startTime: "23:44",
    endTime: "00:07",
  }), "");
});

test("schedule range enforces a seven-calendar-day maximum", () => {
  const schedule = {
    date: "2026-11-19",
    startTime: "09:00",
    endTime: "10:00",
  };

  assert.equal(validateScheduleRange({ ...schedule, endDate: "2026-11-25" }), "");
  assert.equal(
    validateScheduleRange({ ...schedule, endDate: "2026-11-26" }),
    "A schedule can span at most 7 calendar days.",
  );
});

test("overlap checks include following-day portions and allow touching endpoints", () => {
  const overnight = {
    date: "2026-11-19",
    endDate: "2026-11-20",
    startTime: "23:44",
    endTime: "00:07",
  };

  assert.equal(schedulesOverlap(overnight, {
    date: "2026-11-20",
    endDate: "2026-11-20",
    startTime: "00:06",
    endTime: "00:30",
  }), true);
  assert.equal(schedulesOverlap(overnight, {
    date: "2026-11-20",
    endDate: "2026-11-20",
    startTime: "00:07",
    endTime: "00:30",
  }), false);
});

test("moving an overnight schedule across midnight preserves its duration", () => {
  assert.deepEqual(shiftScheduleByMinutes({
    date: "2026-11-19",
    endDate: "2026-11-20",
    startTime: "23:44",
    endTime: "00:07",
  }, 30), {
    date: "2026-11-20",
    endDate: "2026-11-20",
    startTime: "00:14",
    endTime: "00:37",
  });
});
