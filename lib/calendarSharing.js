export function createShareToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashShareToken(token) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function calendarSharingErrorMessage(error) {
  const message = error?.message || String(error);
  const sharingObjectMissing = /(calendar_shares|public\.(get_shared_calendar|save_shared_task|set_shared_task_completion))/i.test(message);
  if (sharingObjectMissing && /(schema cache|could not find|does not exist)/i.test(message)) {
    return "Calendar sharing is not set up in Supabase yet. Run supabase/migrations/20261115_add_task_end_date.sql and supabase/migrations/20261115_add_calendar_sharing.sql in the Supabase SQL Editor, then reload.";
  }
  if (/end_date/i.test(message) && /(column|schema cache)/i.test(message)) {
    return "The Supabase tasks table needs the schedule migration. Run supabase/migrations/20261115_add_task_end_date.sql in the Supabase SQL Editor, then reload.";
  }
  return message;
}
