export function base64ToBlob(s: string, mime: string): Blob {
  const bytes = atob(s); const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
  return new Blob([out], { type: mime });
}
