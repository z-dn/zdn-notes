import { Database } from 'sql.js'
import { loadConfig } from './config'
import {
  taskCreate, taskList, taskGetById, taskUpdateStatus, taskDelete, withDb,
  CreateTaskInput,
} from './db'
import { LockBusyError } from './lock'
import { buildGuiDelegate } from './gui-client'

// ===================================================================
// CLI 兜底命令：zdn-mcp <subcommand> [args]
//   当智能体不支持 MCP stdio 时，可把 CLI 当 shell 工具调用。
//   subcommands: task add / task list / task get / task done / task todo /
//                task delete / config show
// ===================================================================

interface CliOptions {
  dataDir?: string
  waitMs?: number
}

function parseOpts(args: string[]): CliOptions & { rest: string[] } {
  let dataDir: string | undefined
  let waitMs: number | undefined
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && args[i + 1]) {
      dataDir = args[i + 1]
      i++
    } else if (args[i] === '--wait-ms' && args[i + 1]) {
      waitMs = Number(args[i + 1])
      i++
    } else {
      rest.push(args[i])
    }
  }
  return { dataDir, waitMs: Number.isFinite(waitMs) ? waitMs : undefined, rest }
}

function printJson(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n')
}

async function run(
  fn: (db: Database) => Promise<unknown> | unknown,
  opts: { dataDir?: string; waitMs?: number; readonly?: boolean },
  delegated?: { tool: string; args: Record<string, unknown> },
) {
  // GUI-IPC 委托优先：应用在跑时把子命令映射成 tools/call 转发给 GUI（权威单写者），
  // 转发失败时 GUI 在线则明确报错、不回退文件模式（会被 GUI 锁挡超时）。
  if (delegated) {
    try {
      const resp = await buildGuiDelegate({ dataDir: opts.dataDir })({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: delegated.tool, arguments: delegated.args },
      })
      if (resp) {
        if (resp.error) {
          process.stderr.write('Error: ' + (resp.error.message ?? 'unknown tool error') + '\n')
          return 1
        }
        const text = (resp.result as { content?: { text?: string }[] } | undefined)?.content?.[0]?.text
        try {
          printJson(text ? JSON.parse(text) : resp.result)
        } catch {
          printJson(resp.result)
        }
        return 0
      }
    } catch (e) {
      // GUI 在线但 IPC 委托失败（buildGuiDelegate 已含 endpoint 变更重试）
      process.stderr.write('Error: ' + (e instanceof Error ? e.message : String(e)) + '\n')
      return 1
    }
  }
  try {
    const result = await withDb((db) => fn(db), {
      dataDir: opts.dataDir,
      waitMs: opts.waitMs ?? 2000,
      readonly: opts.readonly,
    })
    printJson(result ?? 'OK')
    return 0
  } catch (e) {
    if (e instanceof LockBusyError) {
      process.stderr.write('LockBusy: ' + e.message + '\n')
    } else {
      process.stderr.write('Error: ' + (e instanceof Error ? e.message : String(e)) + '\n')
    }
    return 1
  }
}

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    printHelp()
    return 0
  }
  const first = argv[0]
  const restArgs = argv.slice(1)

  switch (first) {
    case 'task': {
      const scmd = restArgs[0]
      const { dataDir, waitMs, rest } = parseOpts(restArgs.slice(1))
      switch (scmd) {
        case 'add': {
          const title = rest[0]
          if (!title) {
            process.stderr.write('usage: zdn-mcp task add "<title>" [--priority P2] [--due 1720000000000] [--tags a,b] [--category <id>]\n')
            return 1
          }
          const priority = optValue(rest, '--priority')
          const due = optValue(rest, '--due')
          const tagsRaw = optValue(rest, '--tags')
          const category = optValue(rest, '--category')
          const dto: CreateTaskInput = { title }
          if (priority) dto.priority = priority as CreateTaskInput['priority']
          if (due) dto.dueDate = Number(due)
          if (tagsRaw) dto.tags = tagsRaw.split(',').map((s) => s.trim()).filter(Boolean)
          if (category) dto.categoryId = category
          return run((db) => taskCreate(db, dto), { dataDir, waitMs }, { tool: 'task_create', args: { ...dto } })
        }
        case 'list': {
          const status = optValue(rest, '--status')
          const search = optValue(rest, '--search')
          return run(
            (db) => taskList(db, { status, search }),
            { dataDir, waitMs, readonly: true },
            { tool: 'task_list', args: { status, search } },
          )
        }
        case 'get': {
          const id = rest[0]
          if (!id) { process.stderr.write('usage: zdn-mcp task get <id>\n'); return 1 }
          return run((db) => taskGetById(db, id), { dataDir, waitMs, readonly: true }, { tool: 'task_get', args: { id } })
        }
        case 'done':
        case 'todo': {
          const id = rest[0]
          if (!id) { process.stderr.write(`usage: zdn-mcp task ${scmd} <id>\n`); return 1 }
          const status = scmd === 'done' ? 'done' : 'todo'
          return run(
            (db) => taskUpdateStatus(db, id, status),
            { dataDir, waitMs },
            { tool: 'task_update_status', args: { id, status } },
          )
        }
        case 'delete': {
          const id = rest[0]
          if (!id) { process.stderr.write('usage: zdn-mcp task delete <id>\n'); return 1 }
          return run((db) => taskDelete(db, id), { dataDir, waitMs }, { tool: 'task_delete', args: { id } })
        }
        default:
          process.stderr.write('unknown task subcommand: ' + (scmd ?? '') + '\n')
          return 1
      }
    }
    case 'config': {
      if (restArgs[0] === 'show') {
        const cfg = loadConfig()
        printJson(cfg)
        return 0
      }
      process.stderr.write('usage: zdn-mcp config show\n')
      return 1
    }
    case 'help':
    case '--help':
    case '-h':
      printHelp()
      return 0
    default:
      // 兜底：把没有子命令的裸 JSON-RPC 单行输入透传给 stdio 处理
      process.stderr.write('unknown command: ' + first + '\n')
      printHelp()
      return 1
  }
}

function optValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx >= 0 && args[idx + 1]) return args[idx + 1]
  return undefined
}

function printHelp(): void {
  process.stdout.write(
    [
      'ZDNotes MCP / CLI',
      '',
      'MCP (stdio) 模式：',
      '  由支持 MCP 的智能体(DSH/OpenCode/Codex/Qoder)以 stdio server 方式拉起，走 JSON-RPC。',
      '  工具由数据目录下 agent-mcp-config.json 的白名单控制暴露范围。',
      '',
      'CLI 兜底：',
      '  zdn-mcp task add "<title>" [--priority P0..P3] [--due <ms>] [--tags a,b] [--category <id>]',
      '  zdn-mcp task list [--status todo|done] [--search <kw>]',
      '  zdn-mcp task get <id>',
      '  zdn-mcp task done <id>',
      '  zdn-mcp task todo <id>',
      '  zdn-mcp task delete <id>',
      '  zdn-mcp config show',
      '',
      '全局参数： --data-dir <path> 指定数据目录； --wait-ms <ms> 覆盖锁等待上限',
      '',
    ].join('\n'),
  )
}
