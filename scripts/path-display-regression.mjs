// Windows verbatim paths must never reach the clipboard or the UI.
//
// Two layers are covered:
//   1. `readablePath` behaviour (the presentation helper used by the UI).
//   2. A source guard that every clipboard write of a file path goes through it,
//      so a new copy entry point cannot silently regress.
// The native side is covered by `cargo test display` (see the acceptance doc).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'

const server = await createServer({
  server: { host: '127.0.0.1', port: 1471, strictPort: true, hmr: false, watch: null }
})
const { readablePath, displayPathKey, displayFilePath } = await server.ssrLoadModule('./src/features/shell/pathDisplay.ts')

const results = []
const test = async (name, run) => {
  await run()
  results.push(name)
  console.log('PASS ' + name)
}

try {
  await test('1. a verbatim drive path loses the \\\\?\\ prefix', async () => {
    assert.equal(readablePath('\\\\?\\E:\\code\\lightEdit\\design\\icons\\markumo-app.png'), 'E:\\code\\lightEdit\\design\\icons\\markumo-app.png')
    assert.equal(readablePath('\\\\?\\c:\\temp\\a.md'), 'c:\\temp\\a.md')
  })

  await test('2. a verbatim UNC path becomes an ordinary UNC path', async () => {
    assert.equal(readablePath('\\\\?\\UNC\\server\\share\\a.md'), '\\\\server\\share\\a.md')
    assert.equal(readablePath('\\\\?\\unc\\server\\share'), '\\\\server\\share')
  })

  await test('3. ordinary paths are returned unchanged', async () => {
    for (const value of ['C:\\docs\\a.md', '\\\\server\\share\\b.md', '/home/user/c.md', '', 'relative/a.md', '\\\\?\\Volume{x}\\a.md']) {
      assert.equal(readablePath(value), value, value)
    }
  })

  await test('4. unicode, spaces and emoji survive the conversion', async () => {
    assert.equal(readablePath('\\\\?\\E:\\中文 目录\\文件 🙂.md'), 'E:\\中文 目录\\文件 🙂.md')
  })

  await test('5. relative and comparison helpers also ignore the prefix', async () => {
    assert.equal(displayPathKey('\\\\?\\E:\\Docs\\A.md'), displayPathKey('E:\\docs\\a.md'))
    assert.equal(
      displayFilePath('\\\\?\\E:\\root\\sub\\a.md', { rootPath: '\\\\?\\E:\\root', name: 'root' }),
      'sub/a.md',
    )
    assert.equal(
      displayFilePath('\\\\?\\E:\\root\\sub\\a.md', { rootPath: 'E:\\root', name: 'root' }, true),
      'root/sub/a.md',
    )
  })

  await test('6. no copy entry point writes an unnormalised path (source guard)', async () => {
    const sites = [
      ['src/components/layout/Sidebar.vue', 'textClipboard.writeText(readablePath(path))'],
      ['src/components/layout/TabBar.vue', 'textClipboard.writeText(readablePath(doc.path))'],
      ['src/app/useAppShell.ts', 'textClipboard.writeText(readablePath(activeDoc.value.path))'],
    ]
    for (const [file, expected] of sites) {
      const source = fs.readFileSync(file, 'utf8')
      assert.ok(source.includes(expected), `${file} must normalise before copying`)
    }
    // Nothing may write a raw `.path` value to the clipboard any more.
    for (const file of ['src/components/layout/Sidebar.vue', 'src/components/layout/TabBar.vue', 'src/app/useAppShell.ts']) {
      const source = fs.readFileSync(file, 'utf8')
      const raw = source.match(/writeText\((?!readablePath|displayFilePath|p\)|text|`)[^)]*\.path\)/g) || []
      assert.deepEqual(raw, [], `${file} still copies a raw path: ${raw.join(', ')}`)
    }
  })

  await test('7. the native layer strips the same prefixes (mirrors display.rs)', async () => {
    // The Rust implementation is unit-tested by `cargo test display`; assert the
    // rules it documents so a divergence is visible in one place.
    const rust = fs.readFileSync('src-tauri/src/display.rs', 'utf8')
    assert.ok(rust.includes('\\\\?\\UNC\\'), 'UNC verbatim prefix handled')
    assert.ok(rust.includes('display_path(path: &Path)'), 'helper takes a Path')
    assert.ok(rust.includes('display_text('), 'string form available for persisted values')
    const wired = ['src-tauri/src/workspace/service.rs', 'src-tauri/src/files/mod.rs']
    for (const file of wired) {
      assert.ok(fs.readFileSync(file, 'utf8').includes('display_path('), `${file} must use display_path`)
    }
  })
} finally {
  await server.close()
}

console.log('========================================')
console.log(`All ${results.length} path display checks passed!`)
console.log('========================================')
