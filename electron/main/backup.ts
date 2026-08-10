import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import initSqlJs from 'sql.js'
import { getDB, loadValidatedDB, replaceDB } from './database'
import { getImagesDir } from './data-location'

const DB_ENTRY = 'zdn-notes.db'
const IMAGES_DIR_NAME = 'images'

const IMAGE_FILENAME_RE = /^[\w.-]+$/

function isSafeImageFilename(filename: string): boolean {
  if (!filename) return false
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return false
  return IMAGE_FILENAME_RE.test(filename)
}

function imagesDir(): string {
  return getImagesDir()
}

let sqlPromise: ReturnType<typeof initSqlJs> | null = null
function getSQL() {
  if (!sqlPromise) sqlPromise = initSqlJs()
  return sqlPromise
}

export function buildBackupZip(dbBuffer: Uint8Array, imagesDirPath: string, zipPath: string): void {
  const zip = new AdmZip()
  zip.addFile(DB_ENTRY, Buffer.from(dbBuffer))
  if (fs.existsSync(imagesDirPath)) {
    for (const name of fs.readdirSync(imagesDirPath)) {
      if (!isSafeImageFilename(name)) continue
      const filePath = path.join(imagesDirPath, name)
      if (!fs.statSync(filePath).isFile()) continue
      zip.addFile(`${IMAGES_DIR_NAME}/${name}`, fs.readFileSync(filePath))
    }
  }
  zip.writeZip(zipPath)
}

export function readBackupZip(
  zipPath: string
): { dbBuffer: Uint8Array; images: { name: string; data: Buffer }[] } {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()

  const dbEntry = entries.find((e) => e.entryName === DB_ENTRY)
  if (!dbEntry) throw new Error('备份文件中缺少 ' + DB_ENTRY)

  const images: { name: string; data: Buffer }[] = []
  for (const entry of entries) {
    if (entry.entryName === DB_ENTRY) continue
    if (entry.isDirectory) continue
    if (!entry.entryName.startsWith(`${IMAGES_DIR_NAME}/`)) {
      throw new Error('备份文件包含未知条目: ' + entry.entryName)
    }
    const name = entry.entryName.slice(IMAGES_DIR_NAME.length + 1)
    if (!isSafeImageFilename(name)) throw new Error('备份文件包含非法图片文件名: ' + name)
    images.push({ name, data: entry.getData() })
  }
  return { dbBuffer: dbEntry.getData(), images }
}

export function backupDatabase(zipPath: string): void {
  const dbBuffer = getDB().export()
  buildBackupZip(dbBuffer, imagesDir(), zipPath)
}

export async function restoreDatabase(zipPath: string): Promise<void> {
  const SQL = await getSQL()
  const { dbBuffer, images } = readBackupZip(zipPath)

  const validated = loadValidatedDB(dbBuffer, SQL)

  const imgDir = imagesDir()
  if (fs.existsSync(imgDir)) {
    for (const name of fs.readdirSync(imgDir)) {
      if (!isSafeImageFilename(name)) continue
      const filePath = path.join(imgDir, name)
      try {
        if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath)
      } catch {
        /* ignore */
      }
    }
  } else {
    fs.mkdirSync(imgDir, { recursive: true })
  }

  for (const img of images) {
    fs.writeFileSync(path.join(imgDir, img.name), img.data)
  }

  replaceDB(validated)
}
