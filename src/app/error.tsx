"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("app.render_failed", { digest: error.digest ?? "unknown" });
  }, [error.digest]);

  return (
    <main className="route-fallback" role="alert">
      <div>
        <p>خطای موقت</p>
        <h1>نمایش این صفحه کامل نشد</h1>
        <span>گفتگوهای ذخیره‌شده روی این دستگاه باقی می‌مانند.</span>
        <button type="button" onClick={retry}>تلاش دوباره</button>
      </div>
    </main>
  );
}
