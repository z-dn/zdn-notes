import type { Database } from 'sql.js'
import { getDB, saveAsync } from './index'

export function getAllSettings(_db?: Database): Record<string, string> {
  const db = _db ?? getDB()
  const r = db.exec('SELECT key, value FROM settings')
  const settings: Record<string, string> = {}
  if (r[0]) {
    for (const row of r[0].values) {
      settings[row[0] as string] = row[1] as string
    }
  }
  return settings
}

export function setSetting(key: string, value: string, _db?: Database): void {
  const db = _db ?? getDB()
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
  if (!_db) saveAsync()
}
