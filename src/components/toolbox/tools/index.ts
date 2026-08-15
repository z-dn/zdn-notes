import type { ComponentType } from 'react'
import { Braces, FileDiff, Send, type LucideIcon } from 'lucide-react'
import { TOOL_KEYS, type ToolKey } from '@/types/tool'
import { JsonTool } from './json-tool'
import { TextDiffTool } from './text-diff-tool'
import { ApiTool } from './api-tool'

export interface ToolEntry {
  id: ToolKey
  name: string
  description: string
  icon: LucideIcon
  component: ComponentType
}

export const TOOLS: ToolEntry[] = [
  {
    id: TOOL_KEYS.json,
    name: 'JSON 美化',
    description: '格式化 / 压缩 / 校验',
    icon: Braces,
    component: JsonTool,
  },
  {
    id: TOOL_KEYS.textDiff,
    name: '大文本比较',
    description: '双栏行级 diff',
    icon: FileDiff,
    component: TextDiffTool,
  },
  {
    id: TOOL_KEYS.api,
    name: '接口调试',
    description: 'HTTP 请求 / 响应查看',
    icon: Send,
    component: ApiTool,
  },
]
