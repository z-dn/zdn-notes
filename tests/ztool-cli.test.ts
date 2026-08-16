// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ZTOOL = path.resolve(__dirname, '..', 'scripts', 'ztool.mjs')

let dirs: string[] = []
let work: string
let dataDir: string

beforeAll(() => {
  dirs = []
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-ztool-cli-'))
  dataDir = path.join(work, 'data')
  dirs.push(work)
})

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

function run(args: string[]): string {
  return execFileSync(process.execPath, [ZTOOL, ...args], { encoding: 'utf-8' })
}

describe('ztool CLI 冒烟（独立 npm 包脚本）', () => {
  it('init 生成脚手架（ztool.json + index.js）', () => {
    const out = run(['init', path.join(work, 'hello'), 'hello'])
    expect(out).toContain('已创建插件脚手架')
    expect(fs.existsSync(path.join(work, 'hello', 'ztool.json'))).toBe(true)
    expect(fs.existsSync(path.join(work, 'hello', 'index.js'))).toBe(true)
    const manifest = JSON.parse(fs.readFileSync(path.join(work, 'hello', 'ztool.json'), 'utf-8'))
    expect(manifest.id).toBe('hello')
    expect(manifest.apiVersion).toBe(1)
  })

  it('build 产出 .ztool 包', () => {
    const out = run(['build', path.join(work, 'hello'), '-o', path.join(work, 'hello.ztool')])
    expect(out).toContain('已打包')
    expect(fs.existsSync(path.join(work, 'hello.ztool'))).toBe(true)
  })

  it('install 解压到 agent-tools/<id>', () => {
    const out = run(['install', path.join(work, 'hello.ztool'), dataDir])
    expect(out).toContain('已安装到')
    expect(fs.existsSync(path.join(dataDir, 'agent-tools', 'hello', 'ztool.json'))).toBe(true)
  })

  it('list 能列出已安装插件', () => {
    const out = run(['list', dataDir])
    expect(out).toContain('hello')
  })

  it('--help 展示三种开发路径', () => {
    const out = run(['--help'])
    expect(out).toContain('zdn-agent-tool')
    expect(out).toContain('纯手工')
  })
})