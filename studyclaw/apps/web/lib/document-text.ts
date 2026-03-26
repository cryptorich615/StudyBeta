const TEXT_DOCUMENT_PATTERN = /\.(txt|md|markdown|csv|json|log)$/i;

export async function extractDocumentText(file: File) {
  if (file.type.startsWith('text/') || TEXT_DOCUMENT_PATTERN.test(file.name)) {
    return file.text();
  }

  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return extractPdfText(file);
  }

  return '';
}

async function extractPdfText(file: File) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => ('str' in item ? String(item.str) : ''))
      .filter(Boolean)
      .join(' ')
      .trim();

    if (text) {
      pageTexts.push(text);
    }
  }

  return pageTexts.join('\n\n').trim();
}
