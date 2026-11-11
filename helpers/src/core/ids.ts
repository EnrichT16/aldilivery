/** A short, unique, unguessable identifier. `crypto.randomUUID` is in Node 20 and in Workers. */
export function newId(): string {
  return crypto.randomUUID();
}
