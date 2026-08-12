import type { Database, SqlValue } from 'sql.js'

export interface MergeStats {
  tasksAdded: number
  tasksUpdated: number
  categoriesAdded: number
  categoriesUpdated: number
  settingsAdded: number
  imagesAdded: number
}

const TASK_COLS = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'due_date',
  'start_date',
  'reminder_time',
  'parent_id',
  'order_index',
  'tags',
  'owner',
  'category_id',
  'meta',
  'created_at',
  'updated_at',
]

const CATEGORY_COLS = ['id', 'name', 'color', 'sort_order', 'created_at', 'updated_at']

function emptyStats(): MergeStats {
  return { tasksAdded: 0, tasksUpdated: 0, categoriesAdded: 0, categoriesUpdated: 0, settingsAdded: 0, imagesAdded: 0 }
}

function loadIdsWithUpdatedAt(db: Database, table: 'tasks' | 'categories'): Map<string, number> {
  const map = new Map<string, number>()
  const r = db.exec(`SELECT id, updated_at FROM ${table}`)
  if (r[0]) {
    for (const row of r[0].values) {
      map.set(String(row[0]), Number(row[1] ?? 0))
    }
  }
  return map
}

function loadSettingKeys(db: Database): Set<string> {
  const set = new Set<string>()
  const r = db.exec('SELECT key FROM settings')
  if (r[0]) {
    for (const row of r[0].values) set.add(String(row[0]))
  }
  return set
}

function mergeTable(
  target: Database,
  source: Database,
  table: 'tasks' | 'categories',
  whitelist: string[],
  addCounter: 'tasksAdded' | 'categoriesAdded',
  updateCounter: 'tasksUpdated' | 'categoriesUpdated',
  localUpdated: Map<string, number>,
  stats: MergeStats
): void {
  const results = source.exec(`SELECT * FROM ${table}`)
  for (const rs of results) {
    const cols = rs.columns
    const usedCols = whitelist.filter((c) => cols.includes(c))
    if (usedCols.length === 0) continue

    const idIdx = usedCols.indexOf('id')
    const updIdx = usedCols.indexOf('updated_at')
    const insertCols = usedCols.join(', ')
    const placeholders = usedCols.map(() => '?').join(', ')
    const setCols = usedCols.filter((c) => c !== 'id').map((c) => `"${c}" = ?`).join(', ')

    for (const row of rs.values) {
      const values = usedCols.map((c) => row[cols.indexOf(c)] ?? null) as SqlValue[]
      const id = String(values[idIdx])
      const importedUpd = updIdx >= 0 ? Number(values[updIdx] ?? 0) : Number.MAX_SAFE_INTEGER
      const localUpd = localUpdated.get(id)

      if (localUpd === undefined) {
        target.run(`INSERT INTO ${table} (${insertCols}) VALUES (${placeholders})`, values)
        stats[addCounter]++
      } else if (importedUpd > localUpd) {
        const setValues = values.filter((_, i) => i !== idIdx)
        target.run(`UPDATE ${table} SET ${setCols} WHERE id = ?`, [...setValues, values[idIdx]])
        stats[updateCounter]++
      }
    }
  }
}

function mergeSettings(target: Database, source: Database, localKeys: Set<string>, stats: MergeStats): void {
  const r = source.exec('SELECT key, value FROM settings')
  if (r[0]) {
    for (const row of r[0].values) {
      const key = String(row[0])
      if (!localKeys.has(key)) {
        target.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, row[1]])
        stats.settingsAdded++
      }
    }
  }
}

export function mergeDatabase(target: Database, source: Database): MergeStats {
  const stats = emptyStats()
  const tasks = loadIdsWithUpdatedAt(target, 'tasks')
  const categories = loadIdsWithUpdatedAt(target, 'categories')
  const keys = loadSettingKeys(target)

  target.run('BEGIN')
  try {
    mergeTable(target, source, 'tasks', TASK_COLS, 'tasksAdded', 'tasksUpdated', tasks, stats)
    mergeTable(target, source, 'categories', CATEGORY_COLS, 'categoriesAdded', 'categoriesUpdated', categories, stats)
    mergeSettings(target, source, keys, stats)
    target.run('COMMIT')
  } catch (e) {
    target.run('ROLLBACK')
    throw e
  }
  return stats
}
