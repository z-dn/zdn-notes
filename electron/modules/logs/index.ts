import { ipcMain, shell } from 'electron'
import path from 'path'
import {
  appLogFile,
  readAppLogs,
  clearAppLogs,
  onLogEntry,
  type AppLogLevel,
} from '../../core/app-log'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'
import type { AppService } from '../../core/app-service'

// ===================================================================
// logs 核心模块：应用日志查询/清空/打开目录 + 实时推送。
// 数据由各模块经 core/app-log 写入；本模块只做读取与转发。
// ===================================================================

function appService(svc: AppService, ctx: MainModuleContext): void {
  svc.register('logs:get', (query: unknown) => {
    const q = (query ?? {}) as { source?: string; level?: string; limit?: number }
    return readAppLogs(ctx.getDataDir(), {
      source: typeof q.source === 'string' && q.source ? q.source : undefined,
      level: (['info', 'warn', 'error'] as const).includes(q.level as AppLogLevel)
        ? (q.level as AppLogLevel)
        : undefined,
      limit: typeof q.limit === 'number' && q.limit > 0 ? Math.min(q.limit, 2000) : undefined,
    })
  })
  svc.register('logs:clear', () => {
    clearAppLogs(ctx.getDataDir())
    return true
  })
}

function registerIpc(ctx: MainModuleContext): void {
  // 打开日志目录保持 IPC 专属（shell 交互，不进业务层）
  ipcMain.handle('logs:openDir', () => {
    const file = appLogFile(ctx.getDataDir())
    void shell.openPath(path.dirname(file))
    return true
  })

  // 实时推送：任何模块写入日志时通知渲染层增量插入
  onLogEntry((entry) => ctx.send('log:appended', entry))
}

export const logsModule: FeatureModule = {
  id: 'logs',
  name: '日志',
  kind: 'core',
  defaultEnabled: true,
  registerIpc,
  appService,
}
