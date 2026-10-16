import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'

const output = 'test-results/filetree-preview-tab'
await mkdir(output, { recursive: true })

const fixtureModule = `fixture-${Date.now()}.ts`
await writeFile(`${output}/fixture.html`, `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="app" style="height:900px;display:flex;flex-direction:column"></div><script type="module" src="./${fixtureModule}"></script></body></html>`)
await writeFile(`${output}/${fixtureModule}`, `
import { createApp, h, ref } from 'vue'
import { DocumentManager } from '/src/editor/core/DocumentManager.ts'
import { WorkspaceController } from '/src/features/workspace/WorkspaceController.ts'
import { FileController } from '/src/features/files/FileController.ts'
import Sidebar from '/src/components/layout/Sidebar.vue'
import TabBar from '/src/components/layout/TabBar.vue'
import EditorContainer from '/src/components/layout/EditorContainer.vue'
import '/src/styles/reset.css'
import '/src/styles/variables.css'

const manager = new DocumentManager([])

// 内存 Mock Workspace
const filesMap = new Map([
  ['/ws/folder1/file-a.txt', { name: 'file-a.txt', text: 'Content of File A' }],
  ['/ws/folder1/file-b.txt', { name: 'file-b.txt', text: 'Content of File B' }],
  ['/ws/folder1/file-c.txt', { name: 'file-c.txt', text: 'Content of File C' }],
])

const mockGateway = {
  openWorkspaceFile: async (path) => {
    const f = filesMap.get(path) || { name: path.split('/').pop(), text: 'Sample' }
    return {
      token: 'tok-' + path,
      path,
      name: f.name,
      text: f.text,
      encoding: 'UTF-8',
      bom: false,
      eol: '\\n',
      readOnly: false,
      version: 1,
    }
  },
  readDirectory: async (path) => [],
  revealInExplorer: async () => {},
  createFile: async () => ({}),
  createDirectory: async () => ({}),
  deleteFileOrDirectory: async () => {},
  renameFileOrDirectory: async () => ({}),
  moveFileOrDirectory: async () => {},
  findInFiles: async () => 'search-id',
  cancelFind: async () => {},
  onSearchBatch: () => () => {},
  onSearchDone: () => () => {},
  readRecentWorkspaces: async () => [],
  writeRecentWorkspaces: async () => {},
  openWorkspaceDialog: async () => null,
  revealInExplorerToken: async () => {},
}

const mockFileGateway = {
  release: async () => true,
  openDialog: async () => ({ files: [], errors: [] }),
  saveDialog: async () => null,
  openRecent: async () => ({}),
  saveInPlace: async () => ({ version: 1, eol: '\\n', encoding: 'UTF-8', bom: false }),
  saveAs: async () => ({ version: 1, eol: '\\n', encoding: 'UTF-8', bom: false }),
}

const fileController = new FileController(manager, mockFileGateway, () => {})
const workspace = new WorkspaceController(mockGateway, manager, fileController, () => {}, false)

// 注入模拟工作区根节点与目录树
workspace.rootPath = '/ws'
workspace.rootName = 'ws'
workspace.entries = [
  {
    id: '/ws/folder1',
    name: 'folder1',
    path: '/ws/folder1',
    relativePath: 'folder1',
    isDirectory: true,
    isExpanded: true,
    isSymlink: false,
    isReadOnly: false,
    size: 0,
    mtime: null,
    hasChildren: true,
    children: [
      {
        id: '/ws/folder1/file-a.txt',
        name: 'file-a.txt',
        path: '/ws/folder1/file-a.txt',
        relativePath: 'folder1/file-a.txt',
        isDirectory: false,
        isSymlink: false,
        isReadOnly: false,
        size: 10,
        mtime: null,
        hasChildren: false,
      },
      {
        id: '/ws/folder1/file-b.txt',
        name: 'file-b.txt',
        path: '/ws/folder1/file-b.txt',
        relativePath: 'folder1/file-b.txt',
        isDirectory: false,
        isSymlink: false,
        isReadOnly: false,
        size: 10,
        mtime: null,
        hasChildren: false,
      },
      {
        id: '/ws/folder1/file-c.txt',
        name: 'file-c.txt',
        path: '/ws/folder1/file-c.txt',
        relativePath: 'folder1/file-c.txt',
        isDirectory: false,
        isSymlink: false,
        isReadOnly: false,
        size: 10,
        mtime: null,
        hasChildren: false,
      },
    ]
  }
]
workspace.roots = [{ rootPath: '/ws', name: 'ws', entries: workspace.entries }]

const revision = ref(0)
const treeClickMode = ref('double')
manager.subscribe(() => revision.value++)
workspace.subscribe(() => revision.value++)

window.fixture = {
  manager,
  workspace,
  treeClickMode,
  setTreeClickMode: mode => { treeClickMode.value = mode }
}

createApp({
  render() {
    revision.value
    return h('div', { style: 'display:flex;height:100%;width:100%;overflow:hidden' }, [
      h(Sidebar, {
        activePanel: 'files',
        visible: true,
        width: 260,
        appMode: 'workspace',
        treeClickMode: treeClickMode.value,
        workspace,
        desktop: true,
        openDocs: manager.openedDocuments,
        activeDoc: manager.activeDocument,
      }),
      h('div', { style: 'flex:1;display:flex;flex-direction:column;min-width:0' }, [
        h(EditorContainer, {
          doc: manager.activeDocument,
          manager,
          files: fileController,
          desktop: true,
        })
      ])
    ])
  }
}).mount('#app')
`)

const browser = await chromium.launch(browserOptions)
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))

async function test(name, run) {
  await run()
  console.log(`PASS ${name}`)
}

try {
  await page.goto((process.env.LIGHTEDIT_TEST_URL || 'http://127.0.0.1:1422') + `/${output}/fixture.html`)
  await page.locator('.sidebar-wrapper').waitFor()

  await test('1. Double click mode: single-click on file opens Preview Tab immediately', async () => {
    // 确保当前模式为 double
    await page.evaluate(() => window.fixture.setTreeClickMode('double'))
    
    // 单击 file-a.txt
    const fileA = page.locator('.treenode.file', { hasText: 'file-a.txt' })
    await fileA.click()
    await page.waitForTimeout(100)

    // 检查标签栏：出现 file-a.txt，且为 temp (斜体预览)
    const tabA = page.locator('.tab', { hasText: 'file-a.txt' })
    assert.equal(await tabA.count(), 1, 'Tab for file-a exists')
    assert.ok(await tabA.evaluate(el => el.classList.contains('temp')), 'Tab should be temporary/preview')
    assert.equal(await tabA.locator('.filename').evaluate(el => getComputedStyle(el).fontStyle), 'italic', 'Preview tab name is italic')

    // 截图：单文件预览态
    await page.screenshot({ path: `${output}/single-click-file-preview.png` })
  })

  await test('2. Single-click file-b replaces untouched file-a preview tab without increasing tab count', async () => {
    // 单击 file-b.txt
    const fileB = page.locator('.treenode.file', { hasText: 'file-b.txt' })
    await fileB.click()
    await page.waitForTimeout(100)

    // 验证：标签数量仍为 1，file-a 被 file-b 替换！
    assert.equal(await page.locator('.tab').count(), 1, 'Tab count remains 1')
    const currentTab = page.locator('.tab').first()
    assert.equal(await currentTab.locator('.filename').innerText(), 'file-b.txt')
    assert.ok(await currentTab.evaluate(el => el.classList.contains('temp')), 'file-b is temporary preview')

    // 截图：预览替换
    await page.screenshot({ path: `${output}/preview-tab-replaced.png` })
  })

  await test('3. Double-clicking file-b pins it as permanent tab; subsequent file-c does not replace it', async () => {
    // 双击文件树中的 file-b.txt
    const fileB = page.locator('.treenode.file', { hasText: 'file-b.txt' })
    await fileB.dblclick()
    await page.waitForTimeout(100)

    // 验证：file-b 变为永久标签 (pinned, 非斜体)
    const tabB = page.locator('.tab', { hasText: 'file-b.txt' })
    assert.ok(await tabB.evaluate(el => el.classList.contains('pinned')), 'file-b is now pinned')
    assert.equal(await tabB.locator('.filename').evaluate(el => getComputedStyle(el).fontStyle), 'normal', 'Permanent tab name is normal font')

    // 单击 file-c.txt
    const fileC = page.locator('.treenode.file', { hasText: 'file-c.txt' })
    await fileC.click()
    await page.waitForTimeout(100)

    // 验证：file-b 保留，file-c 作为新的 preview 打开，标签总数为 2！
    assert.equal(await page.locator('.tab').count(), 2, 'Tab count is now 2')
    assert.equal(await page.locator('.tab.pinned').count(), 1, 'One pinned tab')
    assert.equal(await page.locator('.tab.temp').count(), 1, 'One preview tab (file-c)')

    // 截图：固定标签与新预览标签共存
    await page.screenshot({ path: `${output}/pinned-plus-preview.png` })
  })

  await test('4. Double clicking permanent tab does NOT unpin it back to preview', async () => {
    const tabB = page.locator('.tab', { hasText: 'file-b.txt' })
    await tabB.dblclick()
    await page.waitForTimeout(100)

    // 依然是 pinned
    assert.ok(await tabB.evaluate(el => el.classList.contains('pinned')), 'Double click keeps pinned')
  })

  await test('5. Editing a preview tab automatically pins it, preventing subsequent replacement', async () => {
    // 切换激活 file-c (preview)
    const tabC = page.locator('.tab', { hasText: 'file-c.txt' })
    await tabC.click()
    await page.waitForTimeout(100)
    assert.ok(await tabC.evaluate(el => el.classList.contains('temp')), 'file-c is temp before edit')

    // 在编辑器中输入修改
    await page.locator('.cm-content').click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' Modified Text')
    await page.waitForTimeout(100)

    // 验证：file-c 自动转换为 pinned 标签，显示未保存点，且字体恢复为正常
    assert.ok(await tabC.evaluate(el => el.classList.contains('pinned')), 'file-c automatically pinned on edit')
    assert.equal(await tabC.locator('.unsaved').count(), 1, 'Unsaved dirty dot displayed')
    assert.equal(await tabC.locator('.filename').evaluate(el => getComputedStyle(el).fontStyle), 'normal', 'Font style becomes normal')

    // 单击 file-a.txt：因为 file-c 已修改固定，file-c 保留，file-a 作为新标签打开！
    const fileA = page.locator('.treenode.file', { hasText: 'file-a.txt' })
    await fileA.click()
    await page.waitForTimeout(100)

    assert.equal(await page.locator('.tab').count(), 3, 'All 3 files remain in tabs')

    // 截图：修改后自动固定
    await page.screenshot({ path: `${output}/edit-auto-pinned.png` })
  })

  await test('6. Folder click behavior adheres to treeClickMode without affecting files', async () => {
    const folder = page.locator('.treenode.folder', { hasText: 'folder1' })

    // 模式 1: double 模式
    await page.evaluate(() => window.fixture.setTreeClickMode('double'))
    // 单击文件夹：只选中，不折叠
    await folder.click()
    await page.waitForTimeout(100)
    assert.equal(await folder.getAttribute('aria-expanded'), 'true', 'Single click does not toggle folder in double mode')

    // 双击文件夹：收起
    await folder.dblclick()
    await page.waitForTimeout(100)
    assert.equal(await folder.getAttribute('aria-expanded'), 'false', 'Double click toggles folder in double mode')

    // 模式 2: single 模式
    await page.evaluate(() => window.fixture.setTreeClickMode('single'))
    // 单击文件夹：立即展开
    await folder.click()
    await page.waitForTimeout(100)
    assert.equal(await folder.getAttribute('aria-expanded'), 'true', 'Single click toggles folder in single mode')

    // 在 single 模式下，文件依然单击打开
    const fileA = page.locator('.treenode.file', { hasText: 'file-a.txt' })
    await fileA.click()
    await page.waitForTimeout(100)
    assert.ok(await page.locator('.tab', { hasText: 'file-a.txt' }).count() > 0, 'File still opens on single click in single mode')
  })

} finally {
  await browser.close()
  if (errors.length) {
    console.error('Page errors encountered:', errors)
  }
}
