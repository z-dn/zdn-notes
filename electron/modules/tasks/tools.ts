import type { AgentTool } from '../../core/contracts'
import {
  taskCreate,
  taskList,
  taskGetById,
  taskUpdateStatus,
  taskUpdate,
  taskDelete,
} from '../../mcp/db'

// ===================================================================
// 任务域内置 Agent 工具（P2 迁移目标：6 个内置工具从 mcp-server 迁入模块）。
// 工具执行上下文为 BuiltinToolContext（含 db，来自 GUI 权威库或 withDb 加载库）。
// 迁移后 mcp-server 不再内联 buildTools，改由 core/tool-registry 统一构建。
// ===================================================================

function builtinCtx(ctx: Parameters<AgentTool['run']>[0]) {
  if (ctx.kind !== 'builtin') throw new Error('内置工具仅支持 builtin 上下文')
  return ctx
}

export const TASK_TOOLS: AgentTool[] = [
  {
    key: 'task:create',
    name: 'task_create',
    label: '创建任务',
    description: '创建一条待办任务',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题（必填）' },
        description: { type: 'string', description: '任务详情（Markdown）' },
        status: { type: 'string', enum: ['todo', 'done'], description: 'todo/done' },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: '优先级' },
        dueDate: { type: 'number', description: '截止时间戳(ms)' },
        startDate: { type: 'number', description: '开始时间戳(ms)' },
        reminderTime: { type: 'number', description: '提醒时间戳(ms)' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        owner: { type: 'string', description: '负责人' },
        categoryId: { type: 'string', description: '分类 id；缺省归入未分类' },
      },
      required: ['title'],
    },
    defaultEnabled: true,
    kind: 'builtin',
    tier: 'core',
    run: (ctx, args) => taskCreate(builtinCtx(ctx).db, args as never),
  },
  {
    key: 'task:read_list',
    name: 'task_list',
    label: '查询任务列表',
    description: '列出待办任务，可按状态/标题关键词过滤',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['todo', 'done'], description: '按状态过滤' },
        search: { type: 'string', description: '按标题模糊搜索' },
      },
    },
    readonly: true,
    defaultEnabled: true,
    kind: 'builtin',
    tier: 'core',
    run: (ctx, args) =>
      taskList(builtinCtx(ctx).db, { status: args.status as string, search: args.search as string }),
  },
  {
    key: 'task:read_detail',
    name: 'task_get',
    label: '查询任务详情',
    description: '按 id 查询单个任务详情',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '任务 id（必填）' } },
      required: ['id'],
    },
    readonly: true,
    defaultEnabled: true,
    kind: 'builtin',
    tier: 'core',
    run: (ctx, args) => taskGetById(builtinCtx(ctx).db, args.id as string),
  },
  {
    key: 'task:update_status',
    name: 'task_update_status',
    label: '更新任务状态(todo/done)',
    description: '切换任务状态（todo/done）；标记 done 会级联完成其子任务',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '任务 id（必填）' },
        status: { type: 'string', enum: ['todo', 'done'], description: '目标状态（必填）' },
      },
      required: ['id', 'status'],
    },
    defaultEnabled: true,
    kind: 'builtin',
    tier: 'core',
    run: (ctx, args) =>
      taskUpdateStatus(builtinCtx(ctx).db, args.id as string, args.status as string),
  },
  {
    key: 'task:update',
    name: 'task_update',
    label: '更新任务内容',
    description: '更新任务内容（标题/详情/优先级/时间/标签/负责人/分类等）',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '任务 id（必填）' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
        dueDate: { type: ['number', 'null'] },
        startDate: { type: ['number', 'null'] },
        reminderTime: { type: ['number', 'null'] },
        tags: { type: 'array', items: { type: 'string' } },
        owner: { type: 'string' },
        categoryId: { type: ['string', 'null'] },
      },
      required: ['id'],
    },
    danger: true,
    defaultEnabled: true,
    kind: 'builtin',
    tier: 'core',
    run: (ctx, args) => taskUpdate(builtinCtx(ctx).db, args.id as string, args),
  },
  {
    key: 'task:delete',
    name: 'task_delete',
    label: '删除任务',
    description: '删除任务（连同其子任务）',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '任务 id（必填）' } },
      required: ['id'],
    },
    danger: true,
    defaultEnabled: true,
    kind: 'builtin',
    tier: 'core',
    run: (ctx, args) => taskDelete(builtinCtx(ctx).db, args.id as string),
  },
]