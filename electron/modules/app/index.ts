import { app } from 'electron'
import { getAllSettings } from '../../main/database/settings-dao'
import { resolveFlags } from '../../core/feature-flags'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'
import type { AppService } from '../../core/app-service'

// 应用业务层：版本/功能开关（UI 与插件 ctx.app 共用）
function appService(svc: AppService, _ctx: MainModuleContext): void {
  svc.register('app:getVersion', () => app.getVersion())
  svc.register('app:getFeatures', () => resolveFlags(getAllSettings()))
}

export const appModule: FeatureModule = {
  id: 'app',
  name: '应用基础',
  kind: 'core',
  defaultEnabled: true,
  appService,
}