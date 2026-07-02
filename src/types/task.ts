export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

export type Status = 'todo' | 'in_progress' | 'done' | 'cancelled'

export interface Category {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: number
}

export interface Task {
  id: string
  title: string
  description: string
  status: Status
  priority: Priority
  dueDate: number | null
  startDate: number | null
  reminderTime: number | null
  parentId: string | null
  orderIndex: number
  tags: string[]
  project: string
  categoryId: string | null
  meta: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface CreateTaskDTO {
  title: string
  description?: string
  status?: Status
  priority?: Priority
  dueDate?: number | null
  startDate?: number | null
  reminderTime?: number | null
  parentId?: string | null
  tags?: string[]
  project?: string
  categoryId?: string | null
}

export interface UpdateTaskDTO extends Partial<CreateTaskDTO> {
  id: string
}

export interface CreateCategoryDTO {
  name: string
  color?: string
}
