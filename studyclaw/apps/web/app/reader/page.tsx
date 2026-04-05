'use client';

import { useSearchParams } from 'next/navigation';
import DocumentReaderWorkspace from '../components/document-reader-workspace';

export default function ReaderPage() {
  const searchParams = useSearchParams();

  return (
    <div className="ereader-shell ereader-shell--workspace">
      <header className="ereader-shell__header">
        <div>
          <p className="eyebrow">StudyClaw eReader</p>
          <h1 className="section-title">Read workspace documents and saved books inside StudyClaw.</h1>
          <p className="muted-copy">
            Library now doubles as a document explorer and focused reading surface. Open uploads, resume where you left off, and keep notes, highlights, and study actions attached to the same file.
          </p>
        </div>
      </header>

      <DocumentReaderWorkspace initialAssetId={searchParams.get('assetId')} mode="full" />
    </div>
  );
}
