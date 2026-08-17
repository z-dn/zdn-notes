import { getAllSettings, setSetting } from '../../main/database/settings-dao'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'
import type { AppService } from '../../core/app-service'

// 应用业务层：设置读写（UI 与插件 ctx.app 共用）
function appService(svc: AppService, _ctx: MainModuleContext): void {
  svc.register('settings:getAll', () => getAllSettings())
  svc.register('settings:set', (key: unknown, value: unknown) => {
    setSetting(String(key), String(value))
    return true
  })
}

export const settingsModule: FeatureModule = {
  id: 'settings',
  name: '设置',
  kind: 'core',
  defaultEnabled: true,
  appService,
}