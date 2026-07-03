import { randomUUID } from 'crypto'
import type { Database } from 'sql.js'
import type { Category, CreateCategoryDTO } from '@/types/task'
import { getDB, saveAsync } from './index'

type Row = Record<string, unknown>

function rowToCategory(row: Row): Category {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    color: row['color'] as string,
    sortOrder: row['sort_order'] as number,
    createdAt: row['created_at'] as number,
  }
}

function getMaxSortOrder(db: Database): number {
  const r = db.exec('SELECT MAX(sort_order) FROM categories')
  return (r[0]?.values[0]?.[0] as number) ?? 0
}

export function createCategory(dto: CreateCategoryDTO, _db?: Database): Category {
  const db = _db ?? getDB()
  const now = Date.now()
  const id = randomUUID()
  const sortOrder = getMaxSortOrder(db) + 1

  try {
    db.run('BEGIN')
    db.run('INSERT INTO categories (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', [id, dto.name, dto.color ?? '#6b7280', sortOrder, now])
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }

  if (!_db) saveAsync()
  return getCategoryById(id, db)!
}

export function getCategoryById(id: string, _db?: Database): Category | null {
  const db = _db ?? getDB()
  const r = db.exec('SELECT * FROM categories WHERE id = ?', [id])
  if (!r[0]?.values.length) return null
  const cols = r[0].columns
  const vals = r[0].values[0]
  const row: Row = {}
  cols.forEach((col, i) => { row[col] = vals[i] })
  return rowToCategory(row)
}

export function getAllCategories(_db?: Database): Category[] {
  const db = _db ?? getDB()
  const r = db.exec('SELECT * FROM categories ORDER BY sort_order ASC')
  if (!r[0]?.values.length) return []
  const cols = r[0].columns
  return r[0].values.map((vals) => {
    const row: Row = {}
    cols.forEach((col, i) => { row[col] = vals[i] })
    return rowToCategory(row)
  })
}

export function updateCategory(id: string, data: Partial<Pick<Category, 'name' | 'color' | 'sortOrder'>>, _db?: Database): Category | null {
  const db = _db ?? getDB()
  const existing = db.exec('SELECT * FROM categories WHERE id = ?', [id])
  if (!existing[0]?.values.length) return null

  const setClause: string[] = []
  const vals: unknown[] = []

  if (data.name !== undefined) { setClause.push('name = ?'); vals.push(data.name) }
  if (data.color !== undefined) { setClause.push('color = ?'); vals.push(data.color) }
  if (data.sortOrder !== undefined) { setClause.push('sort_order = ?'); vals.push(data.sortOrder) }

  if (!setClause.length) return getCategoryById(id, db)

  try {
    db.run('BEGIN')
    db.run(`UPDATE categories SET ${setClause.join(', ')} WHERE id = ?`, [...vals, id])
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }

  if (!_db) saveAsync()
  return getCategoryById(id, db)!
}

export function deleteCategory(id: string, _db?: Database): boolean {
  if (id === '__uncategorized') return false
  const db = _db ?? getDB()

  try {
    db.run('BEGIN')
    db.run("UPDATE tasks SET category_id = '__uncategorized' WHERE category_id = ?", [id])
    db.run('DELETE FROM categories WHERE id = ?', [id])
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }

  if (!_db) saveAsync()
  return true
}

export function getCategoryTaskCounts(_db?: Database): Record<string, number> {
  const db = _db ?? getDB()
  const r = db.exec('SELECT category_id, COUNT(*) as cnt FROM tasks GROUP BY category_id')
  const counts: Record<string, number> = {}
  if (r[0]) {
    for (const row of r[0].values) {
      counts[(row[0] as string) ?? '__uncategorized'] = row[1] as number
    }
  }
  return counts
}