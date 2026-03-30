export default function PageHero({
  badge,
  title,
  description,
  meta,
  actions,
}: {
  badge: string;
  title: string;
  description: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="hero-card hero-card-featured page-hero">
      <div className="hero-copy page-hero__copy">
        <p className="insight-chip page-hero__badge">{badge}</p>
        <h1 className="hero-title">{title}</h1>
        <p className="hero-description">{description}</p>
        {meta ? <div className="hero-meta page-hero__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="hero-actions page-hero__actions">{actions}</div> : null}
    </section>
  );
}
