import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import os from 'os'

const require = createRequire(import.meta.url)
const pty = require('node-pty')
const electronExe = path.resolve('node_modules/electron/dist/electron.exe')
const outFile = path.join(os.tmpdir(), 'dsh-tty-probe2.txt')

const probe = `
  const fs = require('fs')
  const tty = require('tty')
  const out = {}
  try { out.ttyModule = typeof tty.isatty } catch(e){ out.ttyErr = String(e) }
  try { out.isattyStdout = tty.isatty(1) } catch(e){ out.isattyStdoutErr = String(e) }
  try { out.isattyStdin = tty.isatty(0) } catch(e){ out.isattyStdinErr = String(e) }
  try { out.stdoutIsTtyProp = process.stdout.isTTY } catch(e){ out.stdoutIsTtyErr = String(e) }
  try { out.stdinCtor = process.stdin.constructor.name } catch(e){ out.stdinCtorErr = String(e) }
  try { out.stdoutCtor = process.stdout.constructor.name } catch(e){ out.stdoutCtorErr = String(e) }
  fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(out, null, 2))
`

const term = pty.spawn(electronExe, ['-e', probe], {
  cols: 80, rows: 24, name: 'xterm-256color',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TERM: 'xterm-256color' },
})
let buf = ''
term.onData((d) => { buf += d })
term.onExit(() => {
  setTimeout(() => {
    if (fs.existsSync(outFile)) {
      console.log('PROBE RESULT:\n' + fs.readFileSync(outFile, 'utf8'))
      fs.unlinkSync(outFile)
    } else {
      console.log('NO RESULT. raw:', JSON.stringify(buf.slice(-300)))
    }
    process.exit(0)
  }, 200)
})
