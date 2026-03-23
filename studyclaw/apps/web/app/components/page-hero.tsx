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
    <section className="hero-card hero-card-featured">
      <div className="hero-copy">
        <p className="insight-chip">{badge}</p>
        <h1 className="hero-title">{title}</h1>
        <p className="hero-description">{description}</p>
        {meta ? <div className="hero-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="hero-actions">{actions}</div> : null}
    </section>
  );
}
