/** Presentation only. Never use these values to authorize or address file I/O. */
export function readablePath(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return '\\\\' + path.slice(8)
  if (/^\\\\\?\\[a-z]:\\/i.test(path)) return path.slice(4)
  return path
}
export function displayPathKey(path: string) {
  const value = readablePath(path).replace(/\\/g, '/').replace(/\/$/, '')
  return /^[a-z]:(?:\/|$)/i.test(value) || value.startsWith('//') ? value.toLowerCase() : value
}
export function displayFilePath(path: string, root?: { rootPath: string; name: string } | null, multiRoot = false) {
  const full = readablePath(path)
  if (!root) return full
  const normalized = full.replace(/\\/g, '/'), boundary = readablePath(root.rootPath).replace(/\\/g, '/').replace(/\/$/, '') + '/'
  const windows = /^[a-z]:\//i.test(boundary) || boundary.startsWith('//')
  if (!(windows ? normalized.toLowerCase() : normalized).startsWith(windows ? boundary.toLowerCase() : boundary)) return full
  const relative = normalized.slice(boundary.length)
  return multiRoot ? `${root.name}/${relative}` : relative
}
