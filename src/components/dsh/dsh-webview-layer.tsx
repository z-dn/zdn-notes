import { createElement, useEffect } from 'react'
import { useDshUiStore } from '@/stores/dsh-ui-store'

// ===================================================================
// DshWebviewLayer —— App 层常驻的 DSH Web UI webview 保活容器。
//
// 用 webview tag 而非 iframe：DSH 0.1.5 的会话 cookie 为 SameSite=Strict，
// 跨站 iframe（父窗口 file:// 或 localhost → 子框 127.0.0.1）属第三方
// context，cookie 无法建立 → 恒 401「authentication required」（已实测）。
// webview 是独立 top-level webContents，按 first-party 处理 cookie，
// 与早期 webview 时代 / WebContentsView 时代行为一致。
//
// 归属 App.tsx（FadeSwitch 之外的兄弟节点），不随 tab 切换卸载：
//   - 挂载条件 running && webUrl：token 未到不挂载（无 token 会 401 白页，
//     DshPage 的"正在启动"占位需要可见）；webUrl 由主进程从 stdout token 行
//     补发，到货即挂载。重启换 port → key 变化重建；stop 后随条件卸载。
//   - 切走 tab 仅 visibility:hidden（keepMounted）⇒ DSH 内部状态/会话
//     保活，切回零重载。
//   - webview 是 DOM 元素，弹层/胶囊/对话框可自由盖上，无需任何
//     "藏视图" 协调（替代旧 WebContentsView 轨道，白屏类问题结构性消失）。
//   - 注意：webview 必须显式 style 设置宽高（h-full 等类对其不生效）。
//
// 剪贴板权限：DSH 终端复制/粘贴需 clipboard-read/-write，X-Frame 时代的
// iframe allow 属性对 webview 无效，改在 permissionrequest 事件放行；
// 其余权限保持默认拒绝。
// ===================================================================

export function DshWebviewLayer({ active }: { active: boolean }) {
  const running = useDshUiStore((s) => s.running)
  const port = useDshUiStore((s) => s.port)
  const webUrl = useDshUiStore((s) => s.webUrl)
  const setStatus = useDshUiStore((s) => s.setStatus)

  // 全局单订阅：主进程 dsh:statusChanged → store（DshPage / 本层 / tab 绿点共用）。
  // 挂在 App 层常驻组件上（不随 tab/页面卸载），本层 return null 不影响订阅
  useEffect(() => {
    window.electronAPI.dshGetStatus().then((s) => {
      setStatus(s as { running: boolean; port?: number; url?: string })
    })
    const unsub = window.electronAPI.onDshStatusChanged((s) => {
      setStatus(s as { running: boolean; port?: number; url?: string })
    })
    return () => unsub()
  }, [setStatus])

  if (!running || !port || !webUrl) return null

  // webview 事件接管（src 已含 token，无需再处理鉴权）
  const refCb = (node: HTMLElement | null) => {
    if (!node) return
    const wv = node as unknown as {
      addEventListener(
        type: string,
        listener: (e: Event & { permission?: string; request?: { allow(): void; deny(): void } }) => void,
      ): void
    }
    wv.addEventListener('permissionrequest', (e) => {
      if (e.permission && e.permission.includes('clipboard') && e.request) {
        e.request.allow()
      } else {
        e.request?.deny()
      }
    })
  }

  return (
    <div
      className="absolute inset-0 z-10"
      style={{ visibility: active ? 'visible' : 'hidden' }}
      // tab 未激活时不可见即不响应鼠标（visibility 内建）
    >
      {createElement('webview', {
        key: port,
        src: webUrl,
        ref: refCb,
        className: 'h-full w-full border-0',
        style: { width: '100%', height: '100%', background: 'var(--color-panel)' },
        allowpopups: 'false',
      })}
    </div>
  )
}
