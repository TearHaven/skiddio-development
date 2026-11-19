"use client";

import { useEffect, useState } from "react";
import SharedCalendarPage from "@/components/SharedCalendarPage";

export default function SharedCalendarRoute() {
  const [token, setToken] = useState(null);

  useEffect(() => {
    setToken(window.location.hash.slice(1));
  }, []);

  if (token === null) {
    return (
      <main className="shared-calendar-page">
        <header className="shared-calendar-brand"><span>SKIDDIO</span><span>Shared calendar</span></header>
        <section className="card shared-calendar-message">Opening shared calendar…</section>
      </main>
    );
  }

  return <SharedCalendarPage token={token} />;
}
