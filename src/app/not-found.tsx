import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-fallback">
      <div>
        <p>۴۰۴</p>
        <h1>این صفحه پیدا نشد</h1>
        <span>می‌توانید به صفحه اصلی مستندات یا دستیار برگردید.</span>
        <Link href="/">بازگشت به صفحه اصلی</Link>
      </div>
    </main>
  );
}
