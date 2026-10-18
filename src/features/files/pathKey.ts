/** Comparison key for one file path.
 *
 * The native layer is the authority on file identity (it canonicalizes, resolves
 * aliases and compares the native file ID). This key only absorbs the spelling
 * differences that survive that: case on case-insensitive file systems and the
 * separator style. It is never used for I/O.
 */
import { readablePath } from '../shell/pathDisplay'

export function usesCaseInsensitivePaths(platform = navigatorPlatform()) {
  return /win/i.test(platform)
}
function navigatorPlatform(): string {
  const candidate = globalThis.navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined
  return candidate?.userAgentData?.platform || candidate?.platform || ''
}
export function filePathKey(path: string, caseInsensitive = usesCaseInsensitivePaths()) {
  // Trailing separators never change which file a path names.
  const unified = readablePath(path).replace(/\\/g, '/').replace(/\/+$/, '') || (path.startsWith('/') ? '/' : '')
  return caseInsensitive ? unified.toLowerCase() : unified
}
export function sameFilePath(a: string | null | undefined, b: string | null | undefined, caseInsensitive?: boolean) {
  if (!a || !b) return false
  return filePathKey(a, caseInsensitive ?? usesCaseInsensitivePaths()) === filePathKey(b, caseInsensitive ?? usesCaseInsensitivePaths())
}
