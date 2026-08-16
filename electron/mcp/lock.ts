import fs from 'fs'
import path from 'path'

// ===================================================================
// GUI 优先的单写者文件锁
// -------------------------------------------------------------------
// 锁文件位于数据目录下 .zdn-notes.lock，内容为 JSON：
//   { "owner": "gui" | "mcp", "pid": number, "time": number }
//
// 规则：
//  - GUI 拥有最高优先级：GUI 启动时无论当前锁归属都抢占（acquireGuiLock），
//    退出时释放。GUI 是用户正在操作的权威写者。
//  - zdn-mcp 每个写操作为「单短事务」，操作前后快速拿锁/放锁，不长时间持锁 =>
//    不会阻塞 GUI。
//  - zdn-mcp 获取锁时若被 GUI 占用，按 waitMs 短轮询等待，超时抛 LockBusyError。
//  - 锁残留清理：mcp 锁按 pid 判断进程是否存活，死进程锁自动接管；GUI 锁用
//    哨兵 pid (0) 表示，不按时间判废，防止误抢正在使用的 GUI。
// ===================================================================

export const LOCK_FILE = '.zdn-notes.lock'
const GUI_PID = 0 // GUI 进程 PID 对独立进程不可见，固定哨兵标记 GUI 持有

export type LockOwner = 'gui' | 'mcp'

// GUI 运行时暴露的本地 IPC 端点（GUI-IPC 委托模式用）
export interface GuiEndpoint {
  port: number
  token: string
}

export class LockBusyError extends Error {
  constructor(owner: LockOwner, ownerPid: number | null, waitedMs: number) {
    super(
      `数据库被占用中 (owner=${owner}${ownerPid ? `, pid=${ownerPid}` : ''})。已在 ${waitedMs}ms 内重试仍失败，请稍后重试。`,
    )
    this.name = 'LockBusyError'
  }
}

interface LockPayload {
  owner: LockOwner
  pid: number
  time: number
  endpoint?: GuiEndpoint
}

export function lockPath(dataDir: string): string {
  return path.join(dataDir, LOCK_FILE)
}

function readLock(dataDir: string): LockPayload | null {
  try {
    const raw = fs.readFileSync(lockPath(dataDir), 'utf-8')
    const parsed = JSON.parse(raw) as LockPayload
    if (parsed && (parsed.owner === 'gui' || parsed.owner === 'mcp')) return parsed
  } catch {
    /* 无锁或非法 */
  }
  return null
}

function isStale(lock: LockPayload): boolean {
  if (lock.owner === 'gui') {
    // GUI 用哨兵 pid，无法用 kill 判断，视为活跃，防止误抢正在使用的 GUI
    return lock.pid === GUI_PID ? false : true
  }
  try {
    process.kill(lock.pid, 0)
    return false // mcp 进程存活
  } catch {
    return true // 进程不存在，残留锁
  }
}

export function writeLock(dataDir: string, owner: LockOwner, pid: number): void {
  writeLockPayload(dataDir, { owner, pid, time: Date.now() })
}

function writeLockPayload(dataDir: string, payload: LockPayload): void {
  const tmp = lockPath(dataDir) + '.tmp-' + payload.pid
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8')
  fs.renameSync(tmp, lockPath(dataDir))
}

export function releaseLock(dataDir: string): void {
  try {
    const cur = readLock(dataDir)
    if (cur && cur.owner === 'mcp' && cur.pid === process.pid) {
      fs.unlinkSync(lockPath(dataDir))
    }
  } catch {
    /* ignore */
  }
}

// ===== zdn-mcp 侧 =====
export function acquireLock(dataDir: string, waitMs = 2000): void {
  const start = Date.now()
  for (;;) {
    const cur = readLock(dataDir)
    if (!cur) {
      try {
        writeLock(dataDir, 'mcp', process.pid)
      } catch {
        // 竞态窗口占用，重试
        sleepSync(Math.min(50, Math.max(1, waitMs - (Date.now() - start))))
        continue
      }
      // TOCTOU 防护：写入后回读校验，防止并发进程已把锁覆盖成自己的，
      // 若被覆盖则按"他人持锁"继续轮询，而不是两个进程都认为自己持有。
      const mine = readLock(dataDir)
      if (mine && mine.owner === 'mcp' && mine.pid === process.pid) return
      continue
    }
    if (cur.owner === 'mcp') {
      if (cur.pid === process.pid) return // 同一进程重入，已持有
      if (isStale(cur)) {
        writeLock(dataDir, 'mcp', process.pid)
        continue // 下一轮循环回读确认是否真的拿住
      }
      const waited = Date.now() - start
      if (waited >= waitMs) throw new LockBusyError(cur.owner, cur.pid, waited)
    } else {
      // GUI
      if (!isStale(cur)) {
        const waited = Date.now() - start
        if (waited >= waitMs) throw new LockBusyError(cur.owner, cur.pid, waited)
      } else {
        writeLock(dataDir, 'mcp', process.pid)
        continue
      }
    }
    sleepSync(Math.min(50, Math.max(1, waitMs - (Date.now() - start))))
  }
}

function sleepSync(ms: number): void {
  const target = Date.now() + ms
  while (Date.now() < target) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1)
  }
}

// ===== GUI 侧 =====
export function acquireGuiLock(dataDir: string, endpoint?: GuiEndpoint): void {
  const payload: LockPayload = { owner: 'gui', pid: GUI_PID, time: Date.now() }
  if (endpoint) payload.endpoint = endpoint
  writeLockPayload(dataDir, payload)
}

// 读取 GUI 当前暴露的 IPC 端点；GUI 未在跑或无端点时返回 null。
export function readGuiEndpoint(dataDir: string): GuiEndpoint | null {
  const cur = readLock(dataDir)
  if (cur && cur.owner === 'gui' && !isStale(cur) && cur.endpoint) return cur.endpoint
  return null
}

export function isGuiLockHeld(dataDir: string): boolean {
  const cur = readLock(dataDir)
  return !!cur && cur.owner === 'gui' && !isStale(cur)
}

export function releaseGuiLock(dataDir: string): void {
  try {
    const cur = readLock(dataDir)
    if (cur && cur.owner === 'gui') {
      fs.unlinkSync(lockPath(dataDir))
    }
  } catch {
    /* ignore */
  }
}
