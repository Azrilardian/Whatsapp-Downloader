import Database from 'better-sqlite3';
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from 'baileys';

// AD-9: Baileys auth state is worker-owned and lives OUTSIDE the shared
// SQLite seam (shared/app.db) — a dedicated single-file SQLite store here,
// not useMultiFileAuthState (which scatters one file per signal key and is
// slow/fragile to back up). Neither secrets nor session bytes ever land in
// the tables the dashboard reads.

interface AuthStore {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  close: () => void;
}

export function useSqliteAuthState(authDbPath: string): AuthStore {
  const db = new Database(authDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_creds (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_keys (
      type  TEXT NOT NULL,
      id    TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (type, id)
    );
  `);

  const readCreds = db.prepare('SELECT value FROM auth_creds WHERE id = 1');
  const writeCreds = db.prepare(
    'INSERT INTO auth_creds (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
  );
  const readKey = db.prepare('SELECT value FROM auth_keys WHERE type = ? AND id = ?');
  const upsertKey = db.prepare(
    'INSERT INTO auth_keys (type, id, value) VALUES (?, ?, ?) ON CONFLICT(type, id) DO UPDATE SET value = excluded.value',
  );
  const deleteKey = db.prepare('DELETE FROM auth_keys WHERE type = ? AND id = ?');

  const existing = readCreds.get() as { value: string } | undefined;
  const creds: AuthenticationCreds = existing
    ? (JSON.parse(existing.value, BufferJSON.reviver) as AuthenticationCreds)
    : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        for (const id of ids) {
          const row = readKey.get(type, id) as { value: string } | undefined;
          if (row) {
            const value = JSON.parse(row.value, BufferJSON.reviver);
            result[id] =
              type === 'app-state-sync-key' && value
                ? proto.Message.AppStateSyncKeyData.fromObject(value)
                : value;
          }
        }
        return result;
      },
      set: async (data) => {
        const tx = db.transaction(() => {
          for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            const idMap = data[type];
            if (!idMap) continue;
            for (const id of Object.keys(idMap)) {
              const value = idMap[id];
              if (value === null || value === undefined) {
                deleteKey.run(type, id);
              } else {
                upsertKey.run(type, id, JSON.stringify(value, BufferJSON.replacer));
              }
            }
          }
        });
        tx();
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      writeCreds.run(JSON.stringify(state.creds, BufferJSON.replacer));
    },
    close: () => db.close(),
  };
}
