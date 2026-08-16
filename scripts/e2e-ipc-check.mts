// 端到端验证 GUI-IPC 委托：GUI 端点 + GUI 锁 -> stdio mcp 进程转发 -> 落盘到 GUI 权威库
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startMcpIpc } from '../electron/main/mcp-ipc'
import { openDb } from '../electron/mcp/db'
import { acquireGuiLock, releaseGuiLock } from '../electron/mcp/lock'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-e2e-'))
const { db } = await openDb({ dataDir: dir })
const ipc = await startMcpIpc({
  dataDir: dir,
  getDB: () => db,
  saveAsync: () => {},
  notify: () => console.log('[e2e] renderer notified (data:changed)'),
})
acquireGuiLock(dir, { port: ipc.port, token: ipc.token })
console.log('[e2e] GUI endpoint:', ipc.port)

const child = spawn(process.execPath, ['--import', 'tsx', 'electron/mcp/index.ts', '--stdio', '--data-dir', dir], {
  cwd: path.resolve(process.cwd()),
  stdio: ['pipe', 'pipe', 'pipe'],
})

function rpc(payload, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: ' + payload.method)), timeout)
    const onData = (chunk) => {
      const text = chunk.toString().trim()
      if (!text) return
      clearTimeout(t)
      child.stdout.off('data', onData)
      resolve(JSON.parse(text))
    }
    child.stdout.on('data', onData)
    child.stdin.write(JSON.stringify(payload) + '\n')
  })
}

const stderr = []
child.stderr.on('data', (d) => stderr.push(String(d)))

const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
console.log('[e2e] initialize ->', JSON.stringify(init))
if (init.error) throw new Error('init failed')

const created = await rpc({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'task_create', arguments: { title: 'E2E 委托任务', priority: 'P0' } },
})
console.log('[e2e] task_create ->', created.error ? JSON.stringify(created.error) : 'OK (delegated to GUI)')

// 验证写入了 GUI 权威库
const rows = db.exec("SELECT title, priority FROM tasks WHERE title = 'E2E 委托任务'")
if (!rows[0]?.values.length) {
  throw new Error('FAIL: 任务未写入 GUI 权威库')
}
console.log('[e2e] GUI db rows ->', JSON.stringify(rows[0].values))
if (rows[0].values[0][1] !== 'P0') throw new Error('FAIL: priority 不对')

const listed = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'task_list', arguments: {} } })
console.log('[e2e] task_list ->', listed.result.content[0].text)

// 真实 CLI 子进程：应用运行时 `npm run mcp -- task add` 也应委托到 GUI 而非 LockBusy
const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-e2e-cli-'))
const cliDb = (await openDb({ dataDir: cliDir })).db
const ipc2 = await startMcpIpc({
  dataDir: cliDir,
  getDB: () => cliDb,
  saveAsync: () => {},
  notify: () => console.log('[e2e] cli: renderer notified (data:changed)'),
})
acquireGuiLock(cliDir, { port: ipc2.port, token: ipc2.token })
const cliCode = await new Promise((resolve, reject) => {
  const cli = spawn(process.execPath, ['--import', 'tsx', 'electron/mcp/index.ts', 'task', 'add', 'CLI 委托测试', '--data-dir', cliDir], {
    cwd: path.resolve(process.cwd()),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  cli.stdout.on('data', (d) => (out += String(d)))
  cli.stderr.on('data', (d) => (err += String(d)))
  cli.on('close', (c) => resolve({ code: c, out, err }))
  cli.on('error', reject)
})
console.log('[e2e] cli task add stdout ->', cliCode.out.trim())
if (cliCode.err.trim()) console.log('[e2e] cli task add stderr ->', cliCode.err.trim())
if (cliCode.code !== 0 || !cliCode.out.includes('CLI 委托测试')) {
  throw new Error('FAIL: CLI 未委托给 GUI（code=' + cliCode.code + '）')
}
console.log('[e2e] ✅ CLI 委托通过（应用运行时 task add 成功，未走文件锁）')
releaseGuiLock(cliDir)
await ipc2.stop()
fs.rmSync(cliDir, { recursive: true, force: true })

child.kill()
releaseGuiLock(dir)
await ipc.stop()
if (stderr.length) console.log('[e2e] mcp stderr:', stderr.join(''))
fs.rmSync(dir, { recursive: true, force: true })
console.log('[e2e] ✅ 全链路通过：stdio/CLI -> 委托 GUI 执行 -> 落盘权威库')
process.exit(0)