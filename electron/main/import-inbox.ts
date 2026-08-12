import fs from 'fs'
import path from 'path'
import initSqlJs from 'sql.js'
import { getDataDir, getImagesDir } from './data-location'
import { getDB, save, loadValidatedDB } from './database'
import { readBackupZip } from './backup'
import { mergeDatabase, type MergeStats } from './database/import-merge'

const INBOX_DIR = 'inbox'
const IMPORTED_DIR = '_imported'
const REJECTED_DIR = '_rejected'

export function inboxDir(): string {
  return path.join(getDataDir(), INBOX_DIR)
}

export interface InboxResult {
  ok: boolean
  file: string
  stats?: MergeStats
  error?: string
}

let sqlPromise: ReturnType<typeof initSqlJs> | null = null
function getSQL() {
  if (!sqlPromise) sqlPromise = initSqlJs()
  return sqlPromise
}

function ensureDirs(): void {
  fs.mkdirSync(inboxDir(), { recursive: true })
  fs.mkdirSync(path.join(inboxDir(), IMPORTED_DIR), { recursive: true })
  fs.mkdirSync(path.join(inboxDir(), REJECTED_DIR), { recursive: true })
}

function moveTo(dir: string, filePath: string): void {
  const target = path.join(dir, path.basename(filePath))
  if (fs.existsSync(target)) {
    const ext = path.extname(filePath)
    const base = path.basename(filePath, ext)
    fs.renameSync(filePath, path.join(dir, `${base}-${Date.now()}${ext}`))
  } else {
    fs.renameSync(filePath, target)
  }
}

async function processFile(filePath: string): Promise<InboxResult> {
  const name = path.basename(filePath)
  const ext = path.extname(name).toLowerCase()
  try {
    const SQL = await getSQL()
    let validated: ReturnType<typeof loadValidatedDB>
    let images: { name: string; data: Buffer }[] = []

    if (ext === '.db') {
      validated = loadValidatedDB(fs.readFileSync(filePath), SQL)
    } else if (ext === '.zip') {
      const { dbBuffer, images: imgs } = readBackupZip(filePath)
      validated = loadValidatedDB(dbBuffer, SQL)
      images = imgs
    } else {
      throw new Error(`不支持的文件类型: ${ext}`)
    }

    const stats = mergeDatabase(getDB(), validated)
    validated.close()

    const imageDir = getImagesDir()
    if (images.length) {
      fs.mkdirSync(imageDir, { recursive: true })
      for (const img of images) {
        const dest = path.join(imageDir, img.name)
        if (!fs.existsSync(dest)) {
          fs.writeFileSync(dest, img.data)
          stats.imagesAdded++
        }
      }
    }

    save()
    return { ok: true, file: name, stats }
  } catch (e) {
    return { ok: false, file: name, error: e instanceof Error ? e.message : String(e) }
  }
}

function listInboxFiles(): string[] | null {
  try {
    return fs
      .readdirSync(inboxDir())
      .filter((n) => {
        const p = path.join(inboxDir(), n)
        if (!fs.statSync(p).isFile()) return false
        if (Date.now() - fs.statSync(p).mtimeMs < 1500) return false
        return true
      })
      .sort()
  } catch {
    return null
  }
}

export async function processInbox(onResult?: (r: InboxResult) => void): Promise<void> {
  ensureDirs()
  const names = listInboxFiles()
  if (!names) return
  for (const name of names) {
    const filePath = path.join(inboxDir(), name)
    const result = await processFile(filePath)
    moveTo(result.ok ? path.join(inboxDir(), IMPORTED_DIR) : path.join(inboxDir(), REJECTED_DIR), filePath)
    onResult?.(result)
  }
}

let watching = false
let debounceTimer: NodeJS.Timeout | null = null

export function startInboxWatcher(onResult?: (r: InboxResult) => void): void {
  if (watching) return
  ensureDirs()
  watching = true
  processInbox(onResult)

  const run = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => processInbox(onResult), 800)
  }

  try {
    fs.watch(inboxDir(), { persistent: false }, run)
  } catch {
    const interval = setInterval(() => processInbox(onResult), 10_000)
    interval.unref()
  }
}
