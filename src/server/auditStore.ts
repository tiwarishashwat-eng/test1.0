/**
 * Append-only audit history for administrative and operational actions.
 */
import { AuditEntry, User } from '../shared/types.js';
import { dataPath, newId, readJsonFile, writeJsonFileAtomic } from './jsonFile.js';

const MAX_ENTRIES = 20000;

export class AuditStore {
  private readonly file = dataPath('audit.json');
  private entries: AuditEntry[] = readJsonFile<{ entries: AuditEntry[] }>(this.file)?.entries ?? [];

  record(actor: Pick<User, 'id' | 'name'>, action: string, targetType: string, targetId?: string, details?: string): AuditEntry {
    const entry: AuditEntry = {
      id: newId('audit'),
      at: new Date().toISOString(),
      actorId: actor.id,
      actorName: actor.name,
      action,
      targetType,
      targetId,
      details
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    writeJsonFileAtomic(this.file, { entries: this.entries });
    return entry;
  }

  list(filters?: { targetType?: string; targetId?: string; limit?: number }): AuditEntry[] {
    let list = this.entries;
    if (filters?.targetType) list = list.filter((e) => e.targetType === filters.targetType);
    if (filters?.targetId) list = list.filter((e) => e.targetId === filters.targetId);
    return list.slice(-(filters?.limit ?? 500)).reverse();
  }
}

export const auditStore = new AuditStore();

/** Actor used for actions taken by the server's own scheduler. */
export const SYSTEM_ACTOR = { id: 'system', name: 'System scheduler' };
