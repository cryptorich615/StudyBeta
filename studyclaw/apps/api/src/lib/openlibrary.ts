
const BASE = 'https://openlibrary.org';
const COVERS = 'https://covers.openlibrary.org';

export function buildOpenLibraryCoverUrl(coverId: string | number, size: 'S' | 'M' | 'L' = 'M'): string {
  return `${COVERS}/b/id/${coverId}-${size}.jpg`;
}

export async function openLibrarySearchBooks(query: string, limit = 10): Promise<any> {
  const url = `${BASE}/search.json?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url);
  return res.json();
}

export async function openLibraryGetBookDetails(olid: string): Promise<any> {
  const key = olid.startsWith('/works/') ? olid : `/works/${olid}`;
  const res = await fetch(`${BASE}${key}.json`);
  return res.json();
}

export async function openLibraryGetSubjectBooks(subject: string, limit = 10): Promise<any> {
  const url = `${BASE}/subjects/${encodeURIComponent(subject.toLowerCase().replace(/ /g, '_'))}.json?limit=${limit}`;
  const res = await fetch(url);
  return res.json();
}

export async function openLibrarySearchInsideBook(query: string, olid: string): Promise<any> {
  const url = `${BASE}/search/inside.json?q=${encodeURIComponent(query)}&eid=${encodeURIComponent(olid)}`;
  const res = await fetch(url);
  return res.json();
}

export default {
  buildOpenLibraryCoverUrl,
  openLibrarySearchBooks,
  openLibraryGetBookDetails,
  openLibraryGetSubjectBooks,
  openLibrarySearchInsideBook,
};
