import Link from "next/link";

export default function StaffLayout({children}: {children: React.ReactNode}) {
  return (
    <div className="staff-layout" dir="ltr" lang="en">
      <a className="skip-link" href="#staff-main">Skip to main content</a>
      <aside className="staff-sidebar" aria-label="Staff navigation">
        <strong>Grammar Mastery Admin</strong>
        <nav>
          <ul>
            <li><Link href="/staff/questions">Question bank</Link></li>
            <li><Link href="/staff/reviews">Review queue</Link></li>
            <li><Link href="/staff/imports">Imports</Link></li>
            <li><Link href="/staff/questions/bulk-status">Bulk status</Link></li>
            <li><Link href="/staff/audit">Audit log</Link></li>
          </ul>
        </nav>
      </aside>
      <main id="staff-main" className="staff-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
