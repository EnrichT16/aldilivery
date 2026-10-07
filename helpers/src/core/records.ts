/**
 * Where each kind of record lives in the store. One place, so the key layout is easy to read:
 *
 *   knowledge/<helper>/<id>      what a helper has been taught
 *   review/<helper>/<id>         what is waiting for a person
 *   log/<yyyy-mm-dd>/<time>-<id> the plain English log, one folder a day
 *   settings/<helper>            "act alone" switches
 *   state/<name>                 anything else a helper must remember between runs
 */
import { newId } from './ids.js';
import type { Clock, HelperSettings, KnowledgeEntry, LogEntry, ReviewItem } from './types.js';
import { JsonStore, type KeyValueStore } from '../storage/store.js';

export class Records {
  readonly json: JsonStore;
  /** Keeps log entries written in the same millisecond in the order they happened. */
  private sequence = 0;

  constructor(
    store: KeyValueStore,
    readonly clock: Clock,
  ) {
    this.json = new JsonStore(store);
  }

  // Knowledge
  knowledge(helperId: string): Promise<KnowledgeEntry[]> {
    return this.json.list<KnowledgeEntry>(`knowledge/${helperId}/`);
  }
  getKnowledge(helperId: string, id: string): Promise<KnowledgeEntry | null> {
    return this.json.get<KnowledgeEntry>(`knowledge/${helperId}/${id}`);
  }
  saveKnowledge(entry: KnowledgeEntry): Promise<void> {
    return this.json.put(`knowledge/${entry.helperId}/${entry.id}`, entry);
  }
  deleteKnowledge(helperId: string, id: string): Promise<void> {
    return this.json.delete(`knowledge/${helperId}/${id}`);
  }

  // Review list
  reviews(helperId: string): Promise<ReviewItem[]> {
    return this.json.list<ReviewItem>(`review/${helperId}/`);
  }
  getReview(helperId: string, id: string): Promise<ReviewItem | null> {
    return this.json.get<ReviewItem>(`review/${helperId}/${id}`);
  }
  saveReview(item: ReviewItem): Promise<void> {
    return this.json.put(`review/${item.helperId}/${item.id}`, item);
  }

  // Settings
  async settings(helperId: string, defaults: HelperSettings): Promise<HelperSettings> {
    return (await this.json.get<HelperSettings>(`settings/${helperId}`)) ?? defaults;
  }
  saveSettings(helperId: string, settings: HelperSettings): Promise<void> {
    return this.json.put(`settings/${helperId}`, settings);
  }

  // State
  state<T>(name: string): Promise<T | null> {
    return this.json.get<T>(`state/${name}`);
  }
  saveState(name: string, value: unknown): Promise<void> {
    return this.json.put(`state/${name}`, value);
  }

  // Log
  async log(
    helperId: string,
    event: string,
    text: string,
    data?: LogEntry['data'],
  ): Promise<LogEntry> {
    const at = this.clock().toISOString();
    const entry: LogEntry = { id: newId(), at, helperId, event, text, ...(data ? { data } : {}) };
    const order = String(this.sequence++ % 1_000_000).padStart(6, '0');
    await this.json.put(`log/${at.slice(0, 10)}/${at}-${order}-${entry.id}`, entry);
    return entry;
  }

  /** The log for each day from `from` up to and including `to` (UTC dates), oldest first. */
  async logBetween(from: Date, to: Date): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];
    const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    while (day <= to) {
      const prefix = `log/${day.toISOString().slice(0, 10)}/`;
      for (const entry of await this.json.list<LogEntry>(prefix)) {
        const at = new Date(entry.at);
        if (at >= from && at <= to) entries.push(entry);
      }
      day.setUTCDate(day.getUTCDate() + 1);
    }
    return entries;
  }

  /** The most recent `limit` log entries, newest first, looking back up to `days` days. */
  async recentLog(limit = 100, days = 14): Promise<LogEntry[]> {
    const to = this.clock();
    const from = new Date(to.getTime() - days * 86_400_000);
    return (await this.logBetween(from, to)).reverse().slice(0, limit);
  }
}
