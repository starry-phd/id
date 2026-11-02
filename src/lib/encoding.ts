const encoder = new TextEncoder();
// The Workers type definitions omit the `fatal` option, which the runtime supports.
const decoder = new TextDecoder('utf-8', { fatal: true } as unknown as ConstructorParameters<typeof TextDecoder>[1]);

export function utf8(input: string): Uint8Array {
  return encoder.encode(input);
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict base64url decoding: rejects padding, foreign characters and non-canonical input. */
export function base64urlDecode(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(input) || input.length % 4 === 1) throw new Error('BAD_BASE64URL');
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  if (base64urlEncode(bytes) !== input) throw new Error('NON_CANONICAL_BASE64URL');
  return bytes;
}

export function base64urlJson(value: unknown): string {
  return base64urlEncode(utf8(JSON.stringify(value)));
}

/** Parses a base64url-encoded JSON object; returns null for anything else. */
export function parseBase64urlJson(input: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fromUtf8(base64urlDecode(input)));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Copies bytes into a fresh ArrayBuffer, the type WebCrypto expects. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
