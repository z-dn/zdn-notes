// 验证阶段 A：node-pty 能否在 Electron 42 (Node 24.18.1, ABI 131) 内加载并创建真 TTY
// 运行：node scripts/validate-dsh-pty.mjs
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

// 定位 electron 可执行文件
const electronExe =
  process.env.ZDNOTES_ELECTRON_EXE ||
  (() => {
    const candidates = [
      path.resolve('node_modules/electron/dist/electron.exe'),
      path.resolve('node_modules/.bin/electron.cmd'),
    ]
    for (const c of candidates) if (fs.existsSync(c)) return c
    return 'electron'
  })()

console.log('[validate] electron =', electronExe)

// 用 ELECTRON_RUN_AS_NODE 起纯 Node 子进程，验证 node-pty 加载 + 造 TTY
const bootstrap = `
  try {
    const pty = require('node-pty')
    console.log('[child] node-pty loaded OK')
    const nodeBin = process.env.DSH_TEST_NODE || process.execPath
    const term = pty.spawn(nodeBin, [
      '-e',
      "console.log('isTTY=' + process.stdout.isTTY + ' TERM=' + process.env.TERM)"
    ], {
      cols: 80, rows: 24,
      name: 'xterm-256color',
      env: { ...process.env, TERM: 'xterm-256color' }
    })
    let buf = ''
    term.onData(d => { buf += d; process.stdout.write(d) })
    term.onExit(({ exitCode }) => {
      const ok = buf.includes('isTTY=true')
      console.log('[child] PTY result:', ok ? 'PASS (isTTY=true)' : 'FAIL (isTTY not true)')
      process.exit(ok ? 0 : 3)
    })
  } catch (e) {
    console.error('[child] LOAD ERROR:', e && e.message)
    process.exit(2)
  }
`

const child = spawn(electronExe, ['-e', bootstrap], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_TEST_NODE: process.execPath },
  stdio: ['ignore', 'inherit', 'inherit'],
})

let failed = false
child.on('error', (e) => {
  failed = true
  console.error('[validate] spawn error:', e.message)
})
child.on('exit', (code) => {
  if (failed) process.exit(1)
  console.log('[validate] exit code =', code, code === 0 ? '(PASS)' : '(FAIL)')
  process.exit(code ?? 1)
})
