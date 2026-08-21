import type { FeatureModule } from '../core/contracts'
import { tasksModule } from './tasks'
import { categoriesModule } from './categories'
import { settingsModule } from './settings'
import { imagesModule } from './images'
import { backupModule } from './backup'
import { dataLocationModule } from './data-location'
import { inboxModule } from './inbox'
import { toolboxModule } from './toolbox'
import { windowModule } from './window'
import { updaterModule } from './updater'
import { mcpModule } from './mcp'
import { appModule } from './app'
import { notificationsModule } from './notifications'
import { dshModule } from './dsh'

// ===================================================================
// 内置平台模块清单（你本人开发，feature-flag 控制开关）。
// app-shell 装配时注册进 ModuleRegistry。
// ===================================================================
export const BUILTIN_MODULES: FeatureModule[] = [
  appModule,
  windowModule,
  tasksModule,
  categoriesModule,
  settingsModule,
  imagesModule,
  backupModule,
  dataLocationModule,
  inboxModule,
  toolboxModule,
  updaterModule,
  mcpModule,
  notificationsModule,
  dshModule,
]