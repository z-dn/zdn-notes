import { getAllToolState, setToolState } from '../../main/database/tool-state-dao'
import { httpRequest } from '../../main/http-client'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'
import type { AppService } from '../../core/app-service'

// 应用业务层：工具箱状态 + HTTP 请求（UI 与插件 ctx.app 共用）
function appService(svc: AppService, _ctx: MainModuleContext): void {
  svc.register('tool:getAll', () => getAllToolState())
  svc.register('tool:set', (key: unknown, value: unknown) => {
    setToolState(String(key), String(value))
    return true
  })
  svc.register('http:request', (config: unknown) => httpRequest(config as never))
}

export const toolboxModule: FeatureModule = {
  id: 'toolbox',
  name: '工具箱',
  kind: 'optional',
  defaultEnabled: true,
  appService,
  renderer: {
    view: { id: 'toolbox', label: '工具箱' },
  },
}