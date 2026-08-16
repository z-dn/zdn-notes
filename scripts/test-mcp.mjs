// ===================================================================
// zdn-mcp 冒烟测试客户端（无外部依赖，Node 直接跑）
//
// 用法：
//   node scripts/test-mcp.mjs                     # 用 tsx 拉起的 stdio server 逐一测试
//   npm run mcp:test
//
// 它会启动一个个子进程执行 electron/mcp/index.ts，模拟 MCP 客户端：
//   initialize -> tools/list -> tools/call(task_create) -> tools/call(task_list)
// 并打印结果。适合拿到终端环境后快速验证整体链路。
// ===================================================================

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// 用一个临时的（隔离）数据目录测试，避免影响真实数据
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-mcp-test-'))

function runServer() {
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'electron/mcp/index.ts'), '--stdio', '--data-dir', tmpData], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return child
}

function request(child, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout waiting for response for ' + payload.method)), 5000)
    const onData = (chunk) => {
      const text = chunk.toString().trim()
      if (!text) return
      clearTimeout(timeout)
      child.stdout.off('data', onData)
      try {
        const obj = JSON.parse(text)
        resolve(obj)
      } catch (e) {
        reject(e)
      }
    }
    child.stdout.on('data', onData)
    child.stdin.write(JSON.stringify(payload) + '\n')
  })
}

async function main() {
  console.log('tmp data dir: ' + tmpData)
  const child = runServer()
  const stderr = []
  child.stderr.on('data', (d) => stderr.push(String(d)))

  // 1) initialize
  const init = await request(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
  console.log('initialize ->', JSON.stringify(init))
  if (init.error) throw new Error('initialize failed: ' + init.error.message)

  // 2) tools/list
  const list = await request(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const names = (list.result?.tools ?? []).map((t) => t.name).join(', ')
  console.log('tools/list ->', names)
  if (!names.includes('task_create')) throw new Error('task_create missing from tools/list')

  // 3) tools/call task_create
  const created = await request(child, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'task_create', arguments: { title: '冒烟测试任务', priority: 'P1', tags: ['测试'] } },
  })
  console.log('task_create ->', JSON.stringify(created.result?.content?.[0]?.text))
  if (created.error) throw new Error('task_create error: ' + created.error.message)

  // 4) tools/call task_list
  const listed = await request(child, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'task_list', arguments: {} } })
  console.log('task_list ->', listed.result?.content?.[0]?.text)

  child.kill()
  if (stderr.length) console.log('--- stderr ---\n' + stderr.join(''))
  console.log('\n✅ zdn-mcp smoke test passed')
  process.exit(0)
}

main().catch((e) => {
  console.error('\n❌ smoke test failed:', e.message)
  process.exit(1)
})