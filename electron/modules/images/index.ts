import { ipcMain, dialog, protocol, net } from 'electron'
import { randomUUID } from 'crypto'
import { writeFileSync, existsSync, copyFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { getImagesDir } from '../../main/data-location'
import { isSafeImageFilename } from '../../main/image-utils'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'
import type { AppService } from '../../core/app-service'

function saveImageFromData(dataUri: string): string {
  const matches = dataUri.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i)
  if (!matches) throw new Error('Invalid image data URI')
  let ext = matches[1].toLowerCase()
  if (ext === 'jpeg') ext = 'jpg'
  if (ext === 'svg+xml') ext = 'svg'
  if (ext === 'x-icon' || ext === 'vnd.microsoft.icon') ext = 'ico'
  const buffer = Buffer.from(matches[2], 'base64')
  const imageDir = getImagesDir()
  const filename = `${randomUUID()}.${ext}`
  writeFileSync(join(imageDir, filename), buffer)
  return `zdn-img:///${filename}`
}

function deleteImage(url: string): void {
  const filename = url.replace('zdn-img:///', '')
  if (!isSafeImageFilename(filename)) return
  const filePath = join(getImagesDir(), filename)
  if (existsSync(filePath)) unlinkSync(filePath)
}

// 应用业务层：图片存取（UI 与插件 ctx.app 共用）
function appService(svc: AppService, _ctx: MainModuleContext): void {
  svc.register('image:saveFromData', (dataUri: unknown) => saveImageFromData(String(dataUri)))
  svc.register('image:delete', (url: unknown) => deleteImage(String(url)))
}

function registerIpc(_ctx: MainModuleContext): void {
  // 对话框类通道保持 IPC 专属（UI 交互，不进业务层）
  ipcMain.handle('image:pickAndSave', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const srcPath = result.filePaths[0]
    const ext = srcPath.split('.').pop()?.toLowerCase() || 'png'
    const imageDir = getImagesDir()
    const filename = `${randomUUID()}.${ext}`
    copyFileSync(srcPath, join(imageDir, filename))
    return `zdn-img:///${filename}`
  })
}

function onStart(_ctx: MainModuleContext): void {
  const imagesDir = getImagesDir()
  mkdirSync(imagesDir, { recursive: true })
  protocol.handle('zdn-img', (request) => {
    const url = new URL(request.url)
    const filename = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!isSafeImageFilename(filename)) {
      return new Response('Forbidden', { status: 403 })
    }
    const fullPath = join(getImagesDir(), filename)
    return net.fetch(pathToFileURL(fullPath).href)
  })
}

export const imagesModule: FeatureModule = {
  id: 'images',
  name: '图片',
  kind: 'core',
  defaultEnabled: true,
  registerIpc,
  appService,
  onStart,
}