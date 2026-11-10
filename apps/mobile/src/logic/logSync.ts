import type { LogEntry } from '../storage/queue';
import { tr } from '../i18n';

/** Turns base64 (voice recorder output) into bytes. */
export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export type MediaLoader = (path: string) => Promise<Blob>;
const defaultLoader: MediaLoader = async () => { throw new Error(tr('电脑附件暂未开放')); };

/** Builds the multipart body for POST /api/v1/mobile/logs. client_id = local id, so retries never duplicate. */
export async function logForm(e: LogEntry, load: MediaLoader = defaultLoader): Promise<FormData> {
  const f = new FormData();
  f.append('client_id', e.id);
  f.append('kind', e.kind);
  f.append('text', e.note ?? '');
  f.append('captured_at', e.createdAt);
  if (e.durationMs != null) f.append('duration_ms', String(Math.round(e.durationMs)));
  if (e.media && e.kind === 'voice') {
    const mime = (e.mimeType ?? 'audio/aac').split(';')[0];
    f.append('file', base64ToBlob(e.media, mime), `voice.${mime.split('/')[1] ?? 'bin'}`);
  } else if (e.media && e.kind === 'photo') {
    const blob = await load(e.media);
    const mime = e.mimeType === 'image/jpg' ? 'image/jpeg' : (e.mimeType ?? blob.type ?? 'image/jpeg');
    f.append('file', new Blob([blob], { type: mime }), `photo.${mime.split('/')[1]}`);
  }
  return f;
}

export type Choice = 'accepted' | 'ignored' | 'edited';
/** Feedback on one compare item. Lives in screen state for the current entry only (not saved, no history). */
export interface ItemFeedback { choice?: Choice; editedText?: string }
