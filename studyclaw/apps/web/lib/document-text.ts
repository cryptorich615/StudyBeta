const TEXT_DOCUMENT_PATTERN = /\.(txt|md|markdown|csv|tsv|json|log|html?|xml|yaml|yml)$/i;
const RICH_TEXT_PATTERN = /\.rtf$/i;
const WORD_DOCUMENT_PATTERN = /\.(docx|odt)$/i;
const SPREADSHEET_DOCUMENT_PATTERN = /\.(xlsx|ods)$/i;
const PRESENTATION_DOCUMENT_PATTERN = /\.(pptx|odp)$/i;

export async function extractDocumentText(file: File) {
  if (file.type.startsWith('text/') || TEXT_DOCUMENT_PATTERN.test(file.name)) {
    const text = await file.text();
    return file.type.includes('html') || /\.html?$/i.test(file.name) ? extractHtmlText(text) : text;
  }

  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return extractPdfText(file);
  }

  if (file.type === 'application/rtf' || file.type === 'text/rtf' || RICH_TEXT_PATTERN.test(file.name)) {
    return extractRtfText(await file.text());
  }

  if (
    WORD_DOCUMENT_PATTERN.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.type === 'application/vnd.oasis.opendocument.text'
  ) {
    return extractDocxText(file);
  }

  if (
    SPREADSHEET_DOCUMENT_PATTERN.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.oasis.opendocument.spreadsheet'
  ) {
    return extractSpreadsheetText(file);
  }

  if (
    PRESENTATION_DOCUMENT_PATTERN.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    file.type === 'application/vnd.oasis.opendocument.presentation'
  ) {
    return extractPresentationText(file);
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
      .map((item) => ('str' in item ? String(item.str ?? '') : ''))
      .filter(Boolean)
      .join(' ')
      .trim();

    if (text) {
      pageTexts.push(text);
    }
  }

  return pageTexts.join('\n\n').trim();
}

async function loadZip(file: File) {
  const JSZip = (await import('jszip')).default;
  return JSZip.loadAsync(await file.arrayBuffer());
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

function normalizeExtractedText(value: string) {
  return decodeEntities(value)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractHtmlText(value: string) {
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(value, 'text/html');
    return parsed.body?.textContent?.replace(/\s+\n/g, '\n').trim() || '';
  }

  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractRtfText(value: string) {
  return value
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\tab/g, '\t')
    .replace(/\\'[0-9a-f]{2}/gi, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocxText(file: File) {
  const zip = await loadZip(file);
  const parts = await Promise.all(
    ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']
      .map((path) => zip.file(path))
      .filter(Boolean)
      .map((entry) => entry!.async('text'))
  );

  return parts
    .map((part) =>
      normalizeExtractedText(
        part
          .replace(/<\/w:p>/g, '\n\n')
          .replace(/<w:br[^>]*\/>/g, '\n')
      )
    )
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

async function extractSpreadsheetText(file: File) {
  const zip = await loadZip(file);
  const workbookXml = await zip.file('xl/workbook.xml')?.async('text');
  const sheetEntries = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const sheetNames = Array.from(workbookXml?.matchAll(/<sheet[^>]+name="([^"]+)"/g) ?? []).map((match) => decodeEntities(match[1]));
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('text');
  const sharedStrings = Array.from(sharedStringsXml?.matchAll(/<si[\s\S]*?<\/si>/g) ?? []).map((match) =>
    normalizeExtractedText(match[0].replace(/<\/t>/g, ' '))
  );

  const sheets = await Promise.all(
    sheetEntries.map(async (path, index) => {
      const xml = await zip.file(path)?.async('text');
      if (!xml) return '';
      const rows = Array.from(xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)).map((rowMatch) => {
        const rowContent = rowMatch[1];
        const values = Array.from(rowContent.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g))
          .map((cellMatch) => {
            const attributes = cellMatch[1];
            const cellXml = cellMatch[2];
            const isSharedString = /\bt="s"/.test(attributes);
            const inlineString = cellXml.match(/<is>([\s\S]*?)<\/is>/);
            if (inlineString?.[1]) {
              return normalizeExtractedText(inlineString[1]);
            }

            const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
            if (!valueMatch?.[1]) {
              return '';
            }

            const rawValue = decodeEntities(valueMatch[1]);
            if (isSharedString) {
              const shared = sharedStrings[Number(rawValue)];
              return shared ?? rawValue;
            }

            return rawValue;
          })
          .filter(Boolean);

        return values.join(' | ');
      }).filter(Boolean);

      return [`Sheet: ${sheetNames[index] || `Sheet ${index + 1}`}`, ...rows].join('\n');
    })
  );

  return sheets.filter(Boolean).join('\n\n').trim();
}

async function extractPresentationText(file: File) {
  const zip = await loadZip(file);
  const slideEntries = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const slides = await Promise.all(
    slideEntries.map(async (path, index) => {
      const xml = await zip.file(path)?.async('text');
      if (!xml) return '';
      const text = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
        .map((match) => decodeEntities(match[1]))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return `Slide ${index + 1}\n${text || 'No extracted text'}`;
    })
  );

  return slides.filter(Boolean).join('\n\n').trim();
}
