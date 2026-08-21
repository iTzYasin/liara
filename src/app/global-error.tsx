"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("app.global_render_failed", { digest: error.digest ?? "unknown" });
  }, [error.digest]);

  return (
    <html lang="fa" dir="rtl">
      <body>
        <main className="route-fallback" role="alert">
          <div>
            <p>خطای موقت</p>
            <h1>دستیار لیارا در دسترس نیست</h1>
            <span>چند لحظه بعد دوباره تلاش کنید.</span>
            <button type="button" onClick={retry}>تلاش دوباره</button>
          </div>
        </main>
      </body>
    </html>
  );
}
