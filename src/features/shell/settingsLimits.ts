/** Byte-accurate settings limits shared with the Rust validator.
 *
 * `src-tauri/src/commands/settings.rs` compares `String::len()`, which counts
 * UTF-8 bytes, while JavaScript `String.length` counts UTF-16 code units. A
 * 2000-character Chinese path is 2000 code units but 6000 bytes, so a
 * code-unit check lets the web side store values the desktop side rejects.
 * These helpers keep both sides on the same unit.
 */
export const maxImageDirectoryBytes = 4096
export const maxSettingsPathBytes = 16384

const encoder = new TextEncoder()

export function utf8ByteLength(value: string) {
  return encoder.encode(value).length
}

/** A path or directory the Rust validator would accept: within `maxBytes` of
 * UTF-8, and free of NUL characters (Rust rejects `\0` in image rules). */
export function fitsSettingsText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && !value.includes('\0') && utf8ByteLength(value) <= maxBytes
}

/** Settings maps are keyed by absolute file paths. A dynamic key such as
 * `__proto__` must never reach a prototype setter, and `constructor` must not
 * shadow a lookup, so every entry is defined as an own data property. Unlike
 * `target[key] = value` this cannot change the object prototype, and the result
 * stays a plain object: JSON-serializable, Vue-reactive and a faithful
 * `BTreeMap` round trip on the Rust side. */
export function setSettingsEntry<T>(target: Record<string, T>, key: string, value: T) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
}
