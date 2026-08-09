export function LoadingCard({label}: {label: string}) {
  return (
    <section className="surface loading-card" aria-busy="true" aria-label={label}>
      <span className="skeleton skeleton-short" />
      <span className="skeleton skeleton-title" />
      <span className="skeleton" />
      <span className="skeleton" />
      <span className="skeleton" />
      <span className="visually-hidden">{label}</span>
    </section>
  );
}
