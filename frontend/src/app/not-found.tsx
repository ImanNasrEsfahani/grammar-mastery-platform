import Link from "next/link";

export default function NotFound() {
  return (
    <main className="centered-page">
      <section className="surface stack" aria-labelledby="not-found-title">
        <p className="eyebrow">404</p>
        <h1 id="not-found-title">Page not found</h1>
        <p>The requested learning page does not exist or is no longer available.</p>
        <Link className="button button-primary" href="/fa/dashboard">Return to dashboard</Link>
      </section>
    </main>
  );
}
