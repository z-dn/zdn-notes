import { create } from 'zustand'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ConfirmStore {
  isOpen: boolean
  title: string
  message: string
  resolve: ((value: boolean) => void) | null
}

const useConfirmStore = create<ConfirmStore>(() => ({
  isOpen: false,
  title: '',
  message: '',
  resolve: null,
}))

export function showConfirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.setState({ isOpen: true, title, message, resolve })
  })
}

function close(confirmed: boolean) {
  const { resolve } = useConfirmStore.getState()
  resolve?.(confirmed)
  useConfirmStore.setState({ isOpen: false, title: '', message: '', resolve: null })
}

export function ConfirmDialog() {
  const { isOpen, title, message } = useConfirmStore()

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close(false)
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          document.getElementById('task-input')?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => close(true)}>确定</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
