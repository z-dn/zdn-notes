import type { Database } from 'sql.js'
import { getDB, saveAsync } from './index'

export function getAllToolState(_db?: Database): Record<string, string> {
  const db = _db ?? getDB()
  const r = db.exec('SELECT key, value FROM tool_state')
  const state: Record<string, string> = {}
  if (r[0]) {
    for (const row of r[0].values) {
      state[row[0] as string] = row[1] as string
    }
  }
  return state
}

export function setToolState(key: string, value: string, _db?: Database): void {
  const db = _db ?? getDB()
  db.run('INSERT OR REPLACE INTO tool_state (key, value) VALUES (?, ?)', [key, value])
  if (!_db) saveAsync()
}
