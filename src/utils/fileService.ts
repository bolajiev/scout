import { Paths, File, Directory } from 'expo-file-system';

function getFilesDir(): Directory {
  const dir = new Directory(Paths.document, 'peek', 'files');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function sanitizeName(name: string): string {
  let safe = name.replace(/[^a-zA-Z0-9.\-_ ]/g, '_').trim();
  if (!safe.endsWith('.md')) safe = safe.replace(/\.[^.]*$/, '') + '.md';
  if (safe === '.md') safe = 'document.md';
  return safe;
}

export function saveMarkdownFile(name: string, content: string): string {
  const dir = getFilesDir();
  const safeName = sanitizeName(name);
  const file = new File(dir, safeName);
  file.write(content);
  return file.uri;
}

export async function readMarkdownFile(uri: string): Promise<string> {
  return new File(uri).text();
}

export function listMarkdownFiles(): Array<{ name: string; uri: string }> {
  const dir = getFilesDir();
  if (!dir.exists) return [];
  return dir.list()
    .filter(f => f instanceof File && (f as any).name?.endsWith('.md'))
    .map(f => ({ name: (f as any).name as string, uri: (f as any).uri as string }));
}

export function deleteFile(uri: string): void {
  try { new File(uri).delete(); } catch {}
}
