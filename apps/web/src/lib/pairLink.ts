// The pairing QR carries the one-time code in the URL fragment, so scanning it fills the code in.
// A fragment never reaches the server or its logs; the code itself is short-lived, single-use and stored hashed.

export function pairLink(pairUrl: string, code: string): string {
  return `${pairUrl}?code=${encodeURIComponent(code)}`;
}

/** The code from a `#/pair?code=…` fragment, or "" when there is none. */
export function codeFromHash(hash: string): string {
  const q = hash.split("?")[1] ?? "";
  return (new URLSearchParams(q).get("code") ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16);
}
