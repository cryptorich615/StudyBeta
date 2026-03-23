export default function StatusBanner({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
}) {
  return <div className={`status-banner ${tone}`}>{children}</div>;
}
