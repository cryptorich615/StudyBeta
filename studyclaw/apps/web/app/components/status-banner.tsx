export default function StatusBanner({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
}) {
  const label =
    tone === 'success'
      ? 'Success'
      : tone === 'warning'
        ? 'Notice'
        : tone === 'danger'
          ? 'Alert'
          : 'Update';

  return (
    <div className={`status-banner ${tone}`}>
      <span className="status-banner__label">{label}</span>
      <div className="status-banner__content">{children}</div>
    </div>
  );
}
