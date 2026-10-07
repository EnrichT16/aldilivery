/** Small helpers for answering web requests with the standard Request and Response. */

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function text(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

/** A problem, in a sentence a person can act on. */
export function problem(message: string, status = 400): Response {
  return json({ ok: false, message }, status);
}

/** Compares secrets without leaking how much matched through timing. */
export function sameSecret(
  given: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index % a.length] ?? 0) ^ (b[index % b.length] ?? 0);
  }
  return difference === 0;
}

/** Reads a JSON or form body into an object; anything else is an empty object. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body = (await request.json()) as unknown;
      return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    }
    if (
      type.includes('application/x-www-form-urlencoded') ||
      type.includes('multipart/form-data')
    ) {
      const form = await request.formData();
      const out: Record<string, unknown> = {};
      form.forEach((value, key) => {
        if (typeof value === 'string') out[key] = value;
      });
      return out;
    }
    if (type.startsWith('message/rfc822') || type.startsWith('text/plain')) {
      return { raw: await request.text() };
    }
  } catch {
    return {};
  }
  return {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
