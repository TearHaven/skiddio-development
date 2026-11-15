"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { calendarSharingErrorMessage, createShareToken, hashShareToken } from "@/lib/calendarSharing";

export default function CalendarShareDialog({ userId, onClose }) {
  const dialogRef = useRef(null);
  const [share, setShare] = useState(null);
  const [permission, setPermission] = useState("view");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    const storageKey = `skiddio_calendar_share_${userId}`;

    async function loadShare() {
      setLoading(true);
      setError("");
      const { data, error: loadError } = await supabase
        .from("calendar_shares")
        .select("token_hash, permission, revoked_at")
        .eq("owner_id", userId)
        .maybeSingle();
      if (loadError) throw new Error(calendarSharingErrorMessage(loadError));
      if (!active) return;

      setShare(data);
      setPermission(data?.permission || "view");
      const cachedToken = sessionStorage.getItem(storageKey) || "";
      const cachedTokenMatches = data && !data.revoked_at && cachedToken
        ? await hashShareToken(cachedToken) === data.token_hash
        : false;
      if (!active) return;
      if (cachedTokenMatches) {
        setToken(cachedToken);
      } else {
        if (cachedToken) sessionStorage.removeItem(storageKey);
        setToken("");
      }
    }

    loadShare()
      .catch((loadError) => {
        if (active) setError(`Could not load sharing settings: ${loadError.message}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [userId]);

  const activeShare = Boolean(share && !share.revoked_at);
  const shareUrl = token && typeof window !== "undefined" ? `${window.location.origin}/share#${token}` : "";
  const storageKey = `skiddio_calendar_share_${userId}`;

  async function handleCreateOrRotate() {
    if (activeShare && !window.confirm("Replace this link? The current link will stop working.")) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextToken = createShareToken();
      const tokenHash = await hashShareToken(nextToken);
      const { data, error: saveError } = await supabase
        .from("calendar_shares")
        .upsert({
          owner_id: userId,
          token_hash: tokenHash,
          permission,
          revoked_at: null,
        }, { onConflict: "owner_id" })
        .select("token_hash, permission, revoked_at")
        .single();
      if (saveError) throw new Error(calendarSharingErrorMessage(saveError));

      sessionStorage.setItem(storageKey, nextToken);
      setShare(data);
      setToken(nextToken);
      setNotice("Your new share link is ready.");
    } catch (saveError) {
      setError(`Could not create a share link: ${saveError.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handlePermissionChange(nextPermission) {
    setError("");
    setNotice("");
    if (!activeShare) {
      setPermission(nextPermission);
      return;
    }

    setSaving(true);
    try {
      const { data, error: updateError } = await supabase
        .from("calendar_shares")
        .update({ permission: nextPermission })
        .eq("owner_id", userId)
        .select("token_hash, permission, revoked_at")
        .single();
      if (updateError) throw new Error(calendarSharingErrorMessage(updateError));
      setShare(data);
      setPermission(data.permission);
      setNotice(data.permission === "edit" ? "Anyone with the link can now edit." : "Anyone with the link can now view only.");
    } catch (updateError) {
      setError(`Could not update link access: ${updateError.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke() {
    if (!window.confirm("Revoke this link? Future refreshes and edits through it will be denied.")) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { data, error: revokeError } = await supabase
        .from("calendar_shares")
        .update({ revoked_at: new Date().toISOString() })
        .eq("owner_id", userId)
        .select("token_hash, permission, revoked_at")
        .single();
      if (revokeError) throw new Error(calendarSharingErrorMessage(revokeError));
      sessionStorage.removeItem(storageKey);
      setShare(data);
      setToken("");
      setNotice("The share link has been revoked. Anyone who already viewed the calendar may have retained a copy.");
    } catch (revokeError) {
      setError(`Could not revoke the share link: ${revokeError.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    setError("");
    setNotice("");
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice("Link copied to clipboard.");
    } catch (copyError) {
      setError(`Could not copy the link: ${copyError.message || "Clipboard access is unavailable."}`);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="calendar-dialog calendar-share-dialog"
      aria-labelledby="calendar-share-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <div className="calendar-share-heading">
        <div className="calendar-share-mark" aria-hidden="true">↗</div>
        <div>
          <p className="schedule-details-eyebrow">Calendar access</p>
          <h2 id="calendar-share-title">Share your calendar</h2>
        </div>
      </div>

      <p className="calendar-share-explainer">
        Anyone with the link can access this calendar. Shared events include their notes. Keep the link private and revoke it any time.
      </p>

      <label htmlFor="calendar-share-permission">Link access</label>
      <select
        id="calendar-share-permission"
        value={permission}
        disabled={loading || saving}
        onChange={(event) => handlePermissionChange(event.target.value)}
      >
        <option value="view">Viewer — view events and notes</option>
        <option value="edit">Editor — add, edit, move, and complete events</option>
      </select>

      {loading ? (
        <p className="calendar-share-status">Loading sharing settings…</p>
      ) : activeShare && shareUrl ? (
        <div className="calendar-share-link-row">
          <input aria-label="Calendar share link" readOnly value={shareUrl} onFocus={(event) => event.target.select()} />
          <button type="button" className="btn btn-small" onClick={copyLink} disabled={saving}>Copy link</button>
        </div>
      ) : activeShare ? (
        <div className="calendar-share-status">
          This link is active, but its secret is not available in this browser session. Generate a replacement link to copy one; the current link will stop working.
        </div>
      ) : (
        <p className="calendar-share-status">No active share link.</p>
      )}

      {notice && <p className="calendar-share-notice" role="status">{notice}</p>}
      {error && <p className="calendar-dialog-error" role="alert">{error}</p>}

      <div className="calendar-dialog-actions">
        {activeShare && (
          <button type="button" className="btn calendar-btn-secondary" onClick={handleRevoke} disabled={saving}>
            Revoke link
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCreateOrRotate}
          disabled={loading || saving}
        >
          {activeShare ? "Replace link" : "Create share link"}
        </button>
        <button type="button" className="btn calendar-btn-secondary" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
