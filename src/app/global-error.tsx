"use client";

import { useEffect } from "react";

/** Last-resort boundary for errors in the root layout. Renders its own html/body. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, stack: error.stack ?? null, digest: error.digest ?? null, page: location.pathname, kind: "boundary" }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);
  return (
    <html lang="en">
      <body style={{ background: "#080809", color: "#f4f4f5", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div role="alert" style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 24 }}>Wesify hit a problem.</h1>
          <p style={{ color: "#8a8a93" }}>It&apos;s been reported. Your W$ and positions are safe.</p>
          <button type="button" onClick={() => retry()} style={{ marginTop: 16, minHeight: 44, padding: "0 20px", borderRadius: 8, border: 0, background: "#dc143c", color: "#fff", fontWeight: 600 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
