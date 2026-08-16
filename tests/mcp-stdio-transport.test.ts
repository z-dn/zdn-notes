import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

// ===================================================================
// MCP stdio 传输测试：spawn 独立 zdn-mcp（--stdio），验证
//   - stdout 只能承载 JSON-RPC（空行除外），插件/加载日志必须走 stderr
//   - initialize → tools/list → tools/call 完整握手
//   - 进程常驻，stdin 关闭前不退出
// 对应打包后 ZDNotes.exe --zdn-mcp-stdio 委托的纯 Node 子进程同一条链路。
// ===================================================================

const ROOT = process.cwd()

describe('MCP stdio 传输', () => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-mcp-stdio-'))
  let child: ChildProcess
  let outBuf = ''
  let errBuf = ''

  beforeAll(() => {
    // 放入内置 http 插件，验证插件加载日志不污染 stdout
    const pluginDir = path.join(tmpData, 'agent-tools', 'http')
    fs.mkdirSync(pluginDir, { recursive: true })
    fs.copyFileSync(
      path.join(ROOT, 'resources/agent-tools/http/ztool.json'),
      path.join(pluginDir, 'ztool.json'),
    )
    fs.copyFileSync(
      path.join(ROOT, 'resources/agent-tools/http/index.js'),
      path.join(pluginDir, 'index.js'),
    )

    child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(ROOT, 'electron/mcp/index.ts'),
        '--stdio',
        '--data-dir',
        tmpData,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    child.stdout!.on('data', (d) => (outBuf += d.toString()))
    child.stderr!.on('data', (d) => (errBuf += d.toString()))
  })

  afterAll(() => {
    if (child && child.exitCode === null) child.kill()
    fs.rmSync(tmpData, { recursive: true, force: true })
  })

  function send(payload: unknown): void {
    child.stdin!.write(JSON.stringify(payload) + '\n')
  }

  function waitFor(id: number, timeoutMs = 8000): Promise<any> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs
      const tick = () => {
        if (Date.now() > deadline) {
          reject(new Error(`timeout waiting id=${id}; stdout=${JSON.stringify(outBuf)}`))
          return
        }
        const line = outBuf.split('\n').find((l) => {
          try {
            const o = JSON.parse(l)
            return o && o.id === id
          } catch {
            return false
          }
        })
        if (line) {
          resolve(JSON.parse(line))
        } else {
          setTimeout(tick, 30)
        }
      }
      tick()
    })
  }

  it('initialize 握手成功', async () => {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    })
    const resp = await waitFor(1)
    expect(resp.error).toBeUndefined()
    expect(resp.result.protocolVersion).toBe('2024-11-05')
    expect(resp.result.serverInfo.name).toBe('zdn-notes-mcp')
  })

  it('tools/list 包含内置任务工具与 http 插件工具', async () => {
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const resp = await waitFor(2)
    const names = (resp.result.tools as Array<{ name: string }>).map((t) => t.name)
    expect(names).toContain('task_create')
    expect(names).toContain('http_request')
  })

  it('tools/call 执行成功', async () => {
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'task_create', arguments: { title: 'stdio 测试任务', priority: 'P1' } },
    })
    const resp = await waitFor(3)
    expect(resp.error).toBeUndefined()
    expect(resp.result.content[0].text).toContain('stdio 测试任务')
  })

  it('stdout 每行都是合法 JSON（插件加载日志在 stderr）', async () => {
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'task_list', arguments: {} } })
    await waitFor(4)
    const nonBlank = outBuf.split('\n').filter((l) => l.trim() !== '')
    expect(nonBlank.length).toBeGreaterThan(0)
    for (const l of nonBlank) {
      expect(() => JSON.parse(l)).not.toThrow()
    }
    expect(errBuf).toContain('[agent-tools] loaded')
  })

  it('进程常驻，stdin 关闭前不退出', async () => {
    expect(child.exitCode).toBeNull()
  })
})
