import test from "node:test";
import assert from "node:assert/strict";
import { calendarSharingErrorMessage, createShareToken, hashShareToken } from "./calendarSharing.js";

test("share tokens are high-entropy URL-safe hex strings", () => {
  const token = createShareToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.notEqual(token, createShareToken());
});

test("share token hashes are deterministic and distinct from the original token", async () => {
  const token = "a".repeat(64);
  const hash = await hashShareToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await hashShareToken(token), hash);
  assert.notEqual(hash, token);
});

test("missing share migrations produce a direct setup message", () => {
  const message = calendarSharingErrorMessage({
    message: "Could not find the function public.get_shared_calendar(p_token) in the schema cache",
  });
  assert.match(message, /add_calendar_sharing\.sql/);
  assert.match(message, /Supabase SQL Editor/);
});
