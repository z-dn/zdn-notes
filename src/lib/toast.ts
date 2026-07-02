type ToastFn = (msg: string) => void

let _toast: ToastFn = () => {}

export function setToast(fn: ToastFn) {
  _toast = fn
}

export function toast(msg: string) {
  _toast(msg)
}
