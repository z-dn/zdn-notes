// 验证阶段 B：system node (console-subsystem) + node-pty + NODE_PATH 能否 boot DSH
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pty = require('node-pty')

const tmp = process.env.DSH_VALIDATE_TMP || path.join(os.tmpdir(), 'dsh-validate')
const dshBin = path.join(tmp, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dshHome = path.join(tmp, 'dsh-home')

console.log('[validate] dshBin =', dshBin, 'exists=', fs.existsSync(dshBin))

const env = {
  ...process.env,
  NODE_PATH: path.join(tmp, 'node_modules'),
  DSH_HOME: dshHome,
  DEEPSEEK_API_KEY: 'sk-test-validation-key',
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || '',
  TERM: 'xterm-256color',
}

const term = pty.spawn(process.execPath, [dshBin, '--profile', 'dsh-tui'], {
  cols: 120, rows: 40, name: 'xterm-256color', env,
})

let buf = ''
term.onData((d) => {
  buf += d
  process.stdout.write(d)
})
term.onExit(({ exitCode, signal }) => {
  console.log('\n[validate] DSH exited code=', exitCode, 'signal=', signal)
  const text = buf.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*/g, '')
  const lower = text.toLowerCase()
  const hints = ['error', 'cannot', 'enoent', 'module not found', 'profile', 'welcome', 'deepseek', 'login', 'credential']
  const matched = hints.filter((h) => lower.includes(h))
  console.log('[validate] signal keywords in output:', matched.join(', ') || '(none)')
  process.exit(0)
})

// 5 秒后如果还活着就杀掉（说明 TUI 已启动并在等待输入）
setTimeout(() => {
  console.log('\n[validate] still running after 5s → TUI likely booted (killing)')
  term.kill()
}, 5000)
