// 实验数据归档 (板块修改总结: merged into 科研 实验记录): data files picked on the phone are copied into the app's own
// storage under the record they belong to, and can be sent on through the share sheet. They never leave the phone
// otherwise, and they are not in the JSON backup (the record lists their names).
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Share } from '@capacitor/share';
import type { DataFile } from '../storage/queue';

export const MAX_FILE_MB = 25;
const DIR = 'experiments';

/** A file name safe to store: no folders, no control or reserved characters, at most 80 characters, extension kept. */
export function safeName(name: string): string {
  const base = [...name.split(/[\\/]/).pop()!].map(c => (c < ' ' || '<>:"|?*'.includes(c) ? '_' : c)).join('').trim() || 'data';
  if (base.length <= 80) return base;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : '';
  return base.slice(0, 80 - ext.length) + ext;
}

export function fmtSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

export type Picked = { files: DataFile[]; tooBig: string[] };
/** Asks for files and copies each one under the record; files over MAX_FILE_MB are named in tooBig and not kept. */
export async function archiveFiles(entryId: string): Promise<Picked> {
  if (!Capacitor.isNativePlatform()) return { files: [], tooBig: [] };
  const r = await FilePicker.pickFiles({ limit: 0, readData: true });
  const out: Picked = { files: [], tooBig: [] };
  for (const f of r.files) {
    if (f.size > MAX_FILE_MB * 1048576 || !f.data) { out.tooBig.push(f.name); continue; }
    const path = `${DIR}/${entryId}/${safeName(f.name)}`;
    await Filesystem.writeFile({ path, data: f.data, directory: Directory.Data, recursive: true });
    out.files.push({ name: safeName(f.name), path, size: f.size, mime: f.mimeType || undefined });
  }
  return out;
}

/** Opens the share sheet with one archived file, so it can go to a computer, a drive or a message. */
export async function shareDataFile(f: DataFile, title: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const { uri } = await Filesystem.getUri({ path: f.path, directory: Directory.Data });
  await Share.share({ title, files: [uri] });
  return true;
}

/** Removes one archived file from the phone. */
export async function deleteDataFile(f: DataFile): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try { await Filesystem.deleteFile({ path: f.path, directory: Directory.Data }); } catch { /* already gone */ }
}
