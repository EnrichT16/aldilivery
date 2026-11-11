/**
 * Reads a raw email (as Cloudflare Email Routing and IMAP hand it over) into who it is from, the
 * subject and the plain text. Small on purpose: headers, multipart, base64, quoted-printable and
 * the common character sets. Attachments are ignored; the helpers never open them.
 */

export interface IncomingEmail {
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  text: string;
  messageId: string | null;
  /** Header names in lower case. */
  headers: Record<string, string>;
}

/** Bytes as a string of one character per byte, so nothing is lost before decoding. */
export function bytesToBinary(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return out;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index) & 0xff;
  return bytes;
}

function decodeCharset(binary: string, charset: string | undefined): string {
  const bytes = binaryToBytes(binary);
  try {
    return new TextDecoder(
      (charset || 'utf-8').toLowerCase().replace(/^us-ascii$/, 'utf-8'),
    ).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function decodeBase64(text: string): string {
  try {
    return atob(text.replace(/[^A-Za-z0-9+/=]/g, ''));
  } catch {
    return '';
  }
}

function decodeQuotedPrintable(text: string, inHeader = false): string {
  const source = inHeader ? text.replace(/_/g, ' ') : text.replace(/=\r?\n/g, '');
  return source.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/** "=?utf-8?B?...?=" and "=?iso-8859-1?Q?...?=" in headers. */
export function decodeHeader(value: string): string {
  const words = value.replace(/\?=\s+=\?/g, '?==?');
  const decoded = words.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_m, charset: string, encoding: string, text: string) =>
      decodeCharset(
        encoding.toUpperCase() === 'B' ? decodeBase64(text) : decodeQuotedPrintable(text, true),
        charset,
      ),
  );
  // A header without encoded words may still carry raw UTF-8 bytes.
  return decoded === value && /[\x80-\xff]/.test(value) ? decodeCharset(value, 'utf-8') : decoded;
}

function splitHeaders(binary: string): { headers: Record<string, string>; body: string } {
  const match = /\r?\n\r?\n/.exec(binary);
  const head = match ? binary.slice(0, match.index) : binary;
  const body = match ? binary.slice(match.index + match[0].length) : '';
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = decodeHeader(line.slice(colon + 1).trim());
    // Keep the first of each; later ones are usually relays adding their own.
    if (!(name in headers)) headers[name] = value;
  }
  return { headers, body };
}

function parameter(header: string | undefined, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(header ?? '');
  return match ? (match[1] ?? match[2]) : undefined;
}

/** HTML to readable text, for emails that come only as HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** The readable text of one part (and its sub-parts): plain text preferred, else HTML. */
function partText(
  headers: Record<string, string>,
  body: string,
): { plain: string | null; html: string | null } {
  const type = (headers['content-type'] ?? 'text/plain').toLowerCase();
  if (type.startsWith('multipart/')) {
    const boundary = parameter(headers['content-type'], 'boundary');
    if (!boundary) return { plain: null, html: null };
    let plain: string | null = null;
    let html: string | null = null;
    const segments = body.split(`--${boundary}`);
    segments.shift(); // the preamble: "This is a multi-part message in MIME format."
    for (const segment of segments) {
      if (segment.startsWith('--')) break; // the closing boundary
      const piece = segment.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n$/, '');
      if (!piece.trim()) continue;
      const inner = splitHeaders(piece);
      if (/attachment/i.test(inner.headers['content-disposition'] ?? '')) continue;
      const found = partText(inner.headers, inner.body);
      plain ??= found.plain;
      html ??= found.html;
    }
    return { plain, html };
  }
  if (!type.startsWith('text/')) return { plain: null, html: null };
  const encoding = (headers['content-transfer-encoding'] ?? '').toLowerCase();
  const raw =
    encoding === 'base64'
      ? decodeBase64(body)
      : encoding === 'quoted-printable'
        ? decodeQuotedPrintable(body)
        : body;
  const text = decodeCharset(raw, parameter(headers['content-type'], 'charset'));
  return type.startsWith('text/html') ? { plain: null, html: text } : { plain: text, html: null };
}

/** "Jane Smith <jane@example.com>" → { address: "jane@example.com", name: "Jane Smith" }. */
export function parseAddress(value: string): { address: string; name: string | null } {
  const angle = /^(.*?)<([^>]+)>/.exec(value);
  if (angle) {
    const name = (angle[1] ?? '').trim().replace(/^"|"$/g, '').trim();
    return { address: (angle[2] ?? '').trim().toLowerCase(), name: name || null };
  }
  const bare = /[^\s,;<>"]+@[^\s,;<>"]+/.exec(value);
  return { address: (bare?.[0] ?? value).trim().toLowerCase(), name: null };
}

/** Reads a whole raw email. `envelope` overrides from/to with what the mail server saw. */
export function parseRawEmail(
  raw: string | Uint8Array,
  envelope: { from?: string; to?: string } = {},
): IncomingEmail {
  const binary =
    typeof raw === 'string' ? bytesToBinary(new TextEncoder().encode(raw)) : bytesToBinary(raw);
  const { headers, body } = splitHeaders(binary);
  const { plain, html } = partText(headers, body);
  const from = parseAddress(headers.from ?? envelope.from ?? '');
  return {
    from: envelope.from ? parseAddress(envelope.from).address : from.address,
    fromName: from.name,
    to: parseAddress(envelope.to ?? headers.to ?? '').address,
    subject: headers.subject ?? '',
    text: (plain ?? (html ? htmlToText(html) : '')).replace(/\r\n/g, '\n').trim(),
    messageId: headers['message-id'] ?? null,
    headers,
  };
}

/** The newest part of an email: quoted earlier messages and signatures after "-- " taken off. */
export function newestPart(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (/^On .{5,200} wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From:\s.+/.test(line.trim()) && kept.length > 0 && kept[kept.length - 1]?.trim() === '')
      break;
    if (line.trim() === '--') break;
    if (line.startsWith('>')) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}
