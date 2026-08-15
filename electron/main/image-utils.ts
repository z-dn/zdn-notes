const IMAGE_FILENAME_RE = /^[\w.-]+$/

export function isSafeImageFilename(filename: string): boolean {
  if (!filename) return false
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return false
  return IMAGE_FILENAME_RE.test(filename)
}
