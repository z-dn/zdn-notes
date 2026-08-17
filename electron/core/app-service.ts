// ===================================================================
// 统一应用业务层（AppService）—— 与 UI 解耦。
//
// 单一业务注册表：内置模块在此注册"应用能力"（channel → 纯业务函数）。
// 消费方两端共用同一张表：
//   - UI：app-shell 遍历已注册通道，自动生成 ipcMain.handle 包装
//   - 插件：ctx.app(channel, ...args) 经 GUI-IPC 委托调用同一张表
//
// 对话框 / 窗口控制等 UI 专属通道不进此层，保留在模块 registerIpc。
// 本类仅存于主进程（GUI），插件经 loopback 委托访问，不直接持有。
// ===================================================================

export type AppApiFn = (...args: unknown[]) => unknown

export class AppService {
  private handlers = new Map<string, AppApiFn>()

  register(channel: string, fn: AppApiFn): void {
    if (this.handlers.has(channel)) {
      throw new Error(`AppService 通道重复注册: ${channel}`)
    }
    this.handlers.set(channel, fn)
  }

  has(channel: string): boolean {
    return this.handlers.has(channel)
  }

  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (!fn) return Promise.reject(new Error(`AppService 未知通道: ${channel}`))
    try {
      return Promise.resolve(fn(...args))
    } catch (e) {
      return Promise.reject(e)
    }
  }

  channels(): string[] {
    return [...this.handlers.keys()]
  }
}