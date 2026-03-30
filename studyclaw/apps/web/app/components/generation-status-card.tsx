import Link from 'next/link';

export type GenerationStatus = {
  tone: 'neutral' | 'warning' | 'success';
  title: string;
  detail: string;
  kind?: 'flashcards' | 'quiz';
  providerLabel?: string | null;
  modelKey?: string | null;
  countLabel?: string | null;
  href?: string | null;
  ctaLabel?: string | null;
};

type GenerationStatusCardProps = {
  status: GenerationStatus;
};

export default function GenerationStatusCard({ status }: GenerationStatusCardProps) {
  return (
    <section className={`study-generation-card is-${status.tone}`} aria-live="polite">
      <div className="study-generation-card__copy">
        <p className="study-generation-card__eyebrow">
          {status.tone === 'warning' ? 'Generation issue' : status.tone === 'success' ? 'Study asset ready' : 'Generating with OpenClaw'}
        </p>
        <h3>{status.title}</h3>
        <p>{status.detail}</p>
      </div>

      {status.providerLabel || status.modelKey || status.countLabel ? (
        <div className="study-generation-card__meta">
          {status.providerLabel ? <span>{status.providerLabel}</span> : null}
          {status.modelKey ? <span>{status.modelKey}</span> : null}
          {status.countLabel ? <span>{status.countLabel}</span> : null}
        </div>
      ) : null}

      {status.href && status.ctaLabel ? (
        <div className="study-generation-card__actions">
          <Link href={status.href} className="study-generation-card__link">
            {status.ctaLabel}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
