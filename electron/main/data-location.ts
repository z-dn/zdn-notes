import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { isSafeImageFilename } from './image-utils'

const CONFIG_FILE = 'data-location.json'
const DB_ENTRY = 'zdn-notes.db'
const IMAGES_DIR_NAME = 'images'
const INBOX_DIR_NAME = 'inbox'

function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

export function readDataDirConfig(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as { path?: string }
    if (typeof raw.path === 'string' && raw.path.trim()) return raw.path
  } catch {
    /* config missing or invalid */
  }
  return ''
}

export function writeDataDirConfig(dir: string): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify({ path: dir }, null, 2), 'utf-8')
}

export function getDataDir(): string {
  const custom = readDataDirConfig()
  return custom || app.getPath('userData')
}

export function getDbPath(): string {
  return path.join(getDataDir(), DB_ENTRY)
}

export function getImagesDir(): string {
  return path.join(getDataDir(), IMAGES_DIR_NAME)
}

function copyDirContents(srcDir: string, destDir: string): void {
  try {
    if (!fs.existsSync(srcDir)) return
    for (const name of fs.readdirSync(srcDir)) {
      const srcPath = path.join(srcDir, name)
      if (!fs.statSync(srcPath).isFile()) continue
      const destPath = path.join(destDir, name)
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.copyFileSync(srcPath, destPath)
    }
  } catch {
    /* ignore */
  }
}

export function copyDataTo(destDir: string, dbBuffer: Uint8Array, imagesDirPath: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  fs.writeFileSync(path.join(destDir, DB_ENTRY), Buffer.from(dbBuffer))
  const destImages = path.join(destDir, IMAGES_DIR_NAME)
  fs.mkdirSync(destImages, { recursive: true })
  if (fs.existsSync(imagesDirPath)) {
    for (const name of fs.readdirSync(imagesDirPath)) {
      if (!isSafeImageFilename(name)) continue
      const filePath = path.join(imagesDirPath, name)
      if (!fs.statSync(filePath).isFile()) continue
      fs.copyFileSync(filePath, path.join(destImages, name))
    }
  }
  copyDirContents(path.join(getDataDir(), INBOX_DIR_NAME), path.join(destDir, INBOX_DIR_NAME))
}

export function clearDataDir(dir: string): void {
  const dbFile = path.join(dir, DB_ENTRY)
  try {
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile)
  } catch {
    /* ignore */
  }
  const images = path.join(dir, IMAGES_DIR_NAME)
  try {
    if (fs.existsSync(images)) {
      for (const name of fs.readdirSync(images)) {
        if (!isSafeImageFilename(name)) continue
        const filePath = path.join(images, name)
        try {
          if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath)
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  const inbox = path.join(dir, INBOX_DIR_NAME)
  try {
    if (fs.existsSync(inbox)) fs.rmSync(inbox, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
