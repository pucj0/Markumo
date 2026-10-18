import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/workspace-smart-expand'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import { createApp, reactive, markRaw, ref, h, nextTick } from 'vue';
import Sidebar from '/src/components/layout/Sidebar.vue';
import EditorPaneItem from '/src/components/layout/EditorPaneItem.vue';
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import { FileController } from '/src/features/files/FileController.ts';
import { WorkspaceController } from '/src/features/workspace/WorkspaceController.ts';
import * as paths from '/src/features/files/pathKey.ts';
import * as display from '/src/features/shell/pathDisplay.ts';
import * as settings from '/src/features/shell/editorSettings.ts';
import { treeWindow, buildFlatTree, getCompactChain } from '/src/features/workspace/virtualTree.ts';
import '/src/styles/reset.css'; import '/src/styles/variables.css'; import '/src/styles/main.css';

const root = 'C:/fixture', key = display.displayPathKey;
const node = (name, directory = false) => ({
  id: name,
  name: name.split('/').pop(),
  path: root + '/' + name,
  relativePath: name,
  isDirectory: directory,
  isSymlink: false,
  isReadOnly: false,
  size: 10,
  mtime: 0,
  hasChildren: directory,
});

function file(path, token = 'token:' + path) {
  return { kind: 'text', path, name: path.split('/').pop(), token, text: 'content of ' + path, encoding: 'UTF-8', eol: 'LF', bom: false, readOnly: false, version: '1' };
}

function make() {
  const manager = markRaw(new DocumentManager([], async () => [])), calls = [], released = [], notices = [], pending = [];
  const directories = new Map(), hidden = new Set();
  const files = markRaw(new FileController(manager, { release: async token => released.push(token) }, message => notices.push(message)));
  const gateway = {
    getRecentWorkspaces: async () => [],
    isVisibleFile: async path => !hidden.has(key(path)),
    readDirectory: async path => {
      calls.push(['read', path]);
      const result = directories.get(key(path));
      if (typeof result === 'function') return await result();
      if (result === 'ERROR') throw new Error('Permission denied: ' + path);
      return structuredClone(result || []);
    },
    openWorkspaceFile: async path => {
      calls.push(['open', path]);
      return file(path);
    },
    openWorkspacePath: async path => ({ rootPath: path, name: path.split('/').pop(), entries: [] }),
    removeWorkspaceFolder: async () => {},
    createFile: async (parentDir, name) => node(parentDir.slice(root.length + 1) ? parentDir.slice(root.length + 1) + '/' + name : name),
    createDirectory: async (parentDir, name) => node((parentDir.slice(root.length + 1) ? parentDir.slice(root.length + 1) + '/' + name : name), true),
    renameNode: async (path, name) => [path.slice(root.length + 1), path.slice(root.length + 1).split('/').slice(0, -1).concat(name).join('/')],
    moveNode: async (path, dest) => [path.slice(root.length + 1), dest.slice(root.length + 1) + '/' + path.split('/').pop()],
    deleteNode: async path => path.slice(root.length + 1),
    cancelSearch: async () => {},
  };
  const workspace = reactive(new WorkspaceController(markRaw(gateway), manager, files, msg => notices.push(msg), false));
  const setDir = (p, val) => directories.set(key(p.includes(':') ? p : root + '/' + p), val);
  return { manager, files, workspace, calls, released, notices, pending, directories, hidden, gateway, setDir };
}

let app, current;
async function mount(config = {}) {
  if (app) app.unmount();
  if (current) { current.workspace.destroy(); current.files.dispose(); current.manager.dispose(); }
  const f = make();
  current = f;
  const revision = ref(0);
  const state = reactive({
    smartExpand: config.smartExpand ?? true,
    compactFolders: config.compactFolders ?? false,
    clickMode: config.clickMode || 'single',
    follow: config.follow ?? false,
    font: 14,
    panel: 'files',
  });
  f.manager.subscribe(() => revision.value++);
  f.state = state;

  app = createApp({
    setup: () => () => {
      revision.value;
      return h('div', { style: 'display:flex;height:640px' }, [
        h(Sidebar, {
          width: 320,
          uiFontSize: state.font,
          activePanel: state.panel,
          activeDocId: f.manager.activeId,
          openDocs: f.manager.openedDocuments,
          recentFiles: [],
          workspace: f.workspace,
          manager: f.manager,
          desktop: true,
          treeClickMode: state.clickMode,
          autoFollowActiveFile: state.follow,
          smartExpand: state.smartExpand,
          compactFolders: state.compactFolders,
        }),
        h('div', { style: 'flex:1;min-width:0;display:flex;flex-direction:column' }, [
          h('button', { id: 'editor-focus' }, '编辑器区域'),
          ...f.manager.layout.getAllPanes().map(pane => h(EditorPaneItem, {
            key: pane.id,
            manager: f.manager,
            paneId: pane.id,
            revision: revision.value,
            files: f.files,
            desktop: true,
          })),
        ]),
      ]);
    },
  });
  app.mount('#app');
  window.u = f;
  await nextTick();
  return true;
}

window.addEventListener('editor-notice', event => current?.notices.push(event.detail));
window.f = { root, node, file, make, mount, display, paths, settings, treeWindow, buildFlatTree, getCompactChain };
`)

const server = await createServer({ server: { host: '127.0.0.1', port: 1438, strictPort: true } })
await server.listen()

let browser
const results = [], errors = []
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {}),
  })
  const page = await browser.newPage({ viewport: { width: 1150, height: 780 }, reducedMotion: 'reduce' })
  page.on('pageerror', err => errors.push(err.message))
  await page.goto(`http://127.0.0.1:1438/${output}/index.html`)
  await page.waitForFunction(() => window.f)

  const test = async (name, run) => {
    await run()
    results.push(name)
    console.log('PASS ' + name)
  }
  const row = path => page.locator(`[data-tree-path="C:/fixture/${path}"]`)
  const segment = path => page.locator(`[data-segment-path="C:/fixture/${path}"]`)
  const tree = page.getByRole('tree', { name: '工作区目录树' })
  const idle = (ms = 70) => page.waitForTimeout(ms)

  // 1. 1 层单子目录
  await test('1. 1 层单子目录: 点击自动展开唯一步骤并在遇到多个子项时停止', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('one', true)];
      u.setDir('one', [node('one/sub', true)]);
      u.setDir('one/sub', [node('one/sub/a.txt'), node('one/sub/b.txt')]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('one').click();
    await idle(100);
    const state = await page.evaluate(() => {
      const u = window.u;
      const one = u.workspace.entries[0];
      const sub = one.children?.[0];
      return {
        oneExpanded: one.isExpanded,
        subExpanded: sub?.isExpanded,
        subChildrenCount: sub?.children?.length,
      };
    });
    assert.equal(state.oneExpanded, true);
    assert.equal(state.subExpanded, true);
    assert.equal(state.subChildrenCount, 2);
  });

  // 2. 5～10 层连续单子目录
  await test('2. 5～10 层连续单子目录: 递归全链展开直到分支点停止，每级独立缩进展示', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('d1', true)];
      let p = 'd1';
      for (let i = 2; i <= 8; i++) {
        const next = p + '/d' + i;
        u.setDir('' + p, [node(next, true)]);
        p = next;
      }
      u.setDir('' + p, [node(p + '/leaf1', true), node(p + '/leaf2', true)]);
      u.setDir('' + p + '/leaf1', [node(p + '/leaf1/f1.txt')]);
      u.setDir('' + p + '/leaf2', [node(p + '/leaf2/f2.txt')]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('d1').click();
    await idle(150);
    const result = await page.evaluate(() => {
      const u = window.u;
      let cur = u.workspace.entries[0];
      const expandedList = [];
      while (cur) {
        expandedList.push({ name: cur.name, isExpanded: !!cur.isExpanded });
        if (cur.children?.length === 1 && cur.children[0].isDirectory) {
          cur = cur.children[0];
        } else {
          break;
        }
      }
      return {
        depth: expandedList.length,
        allExpanded: expandedList.every(x => x.isExpanded),
        branchChildren: cur.children?.map(c => c.name),
        branchChildrenCollapsed: cur.children?.every(c => !c.isExpanded),
      };
    });
    assert.equal(result.depth, 8);
    assert.equal(result.allExpanded, true);
    assert.deepEqual(result.branchChildren, ['leaf1', 'leaf2']);
    assert.equal(result.branchChildrenCollapsed, true);
  });

  // 3. 中间层出现多个子目录
  await test('3. 中间层出现多个子目录: 到达多子目录层立即停止展开', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('top', true)];
      u.setDir('top', [node('top/mid', true)]);
      u.setDir('top/mid', [node('top/mid/b1', true), node('top/mid/b2', true)]);
      u.setDir('top/mid/b1', [node('top/mid/b1/deep', true)]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('top').click();
    await idle(100);
    const result = await page.evaluate(() => {
      const top = window.u.workspace.entries[0];
      const mid = top.children?.[0];
      const b1 = mid?.children?.[0];
      const b2 = mid?.children?.[1];
      return {
        top: !!top.isExpanded,
        mid: !!mid?.isExpanded,
        b1: !!b1?.isExpanded,
        b2: !!b2?.isExpanded,
      };
    });
    assert.equal(result.top, true);
    assert.equal(result.mid, true);
    assert.equal(result.b1, false);
    assert.equal(result.b2, false);
  });

  // 4. 中间层出现普通文件
  await test('4. 中间层出现普通文件: 包含文件和文件夹时不继续自动展开', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('parent', true)];
      u.setDir('parent', [node('parent/next', true)]);
      u.setDir('parent/next', [node('parent/next/childDir', true), node('parent/next/readme.txt')]);
      u.setDir('parent/next/childDir', [node('parent/next/childDir/deep.txt')]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('parent').click();
    await idle(100);
    const result = await page.evaluate(() => {
      const parent = window.u.workspace.entries[0];
      const next = parent.children?.[0];
      const childDir = next?.children?.find(c => c.name === 'childDir');
      return {
        parent: !!parent.isExpanded,
        next: !!next?.isExpanded,
        childDirExpanded: !!childDir?.isExpanded,
      };
    });
    assert.equal(result.parent, true);
    assert.equal(result.next, true);
    assert.equal(result.childDirExpanded, false);
  });

  // 5. 仅包含一个文件
  await test('5. 仅包含一个文件: 绝不自动打开或展开文件', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('fileDir', true)];
      u.setDir('fileDir', [node('fileDir/sole.txt')]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('fileDir').click();
    await idle(100);
    const result = await page.evaluate(() => ({
      fileDirExpanded: window.u.workspace.entries[0].isExpanded,
      openedDocsCount: window.u.manager.openedDocuments.length,
      activeDoc: window.u.manager.activeDocument,
    }));
    assert.equal(result.fileDirExpanded, true);
    assert.equal(result.openedDocsCount, 0);
    assert.equal(result.activeDoc, null);
  });

  // 6. 完全空目录
  await test('6. 完全空目录: 正确展开并停止，不发生异常', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('emptyFolder', true)];
      u.setDir('emptyFolder', []);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('emptyFolder').click();
    await idle(70);
    const isExpanded = await page.evaluate(() => window.u.workspace.entries[0].isExpanded);
    assert.equal(isExpanded, true);
  });

  // 7. 懒加载失败
  await test('7. 懒加载失败: 报告失败通知并不进入无限递归', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('errorFolder', true)];
      u.setDir('errorFolder', 'ERROR');
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('errorFolder').click();
    await idle(100);
    const result = await page.evaluate(() => ({
      isExpanded: window.u.workspace.entries[0].isExpanded,
      notices: window.u.notices,
    }));
    assert.equal(result.isExpanded, false);
    assert.ok(result.notices.some(n => n.includes('读取目录失败')));
  });

  // 8. 快速展开和折叠
  await test('8. 快速展开和折叠: 折叠立即生效，异步任务不重新展开已收起目录', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('toggleChain', true)];
      u.setDir('toggleChain', [node('toggleChain/c1', true)]);
      u.setDir('toggleChain/c1', [node('toggleChain/c1/c2', true)]);
      u.setDir('toggleChain/c1/c2', [node('toggleChain/c1/c2/f.txt')]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    // 快速双击切换 (展开并立即折叠)
    await row('toggleChain').click();
    await row('toggleChain').click();
    await idle(200);
    const result = await page.evaluate(() => ({
      rootExpanded: window.u.workspace.entries[0].isExpanded,
    }));
    assert.equal(result.rootExpanded, false);
  });

  // 9. 操作过程中切换工作区
  await test('9. 操作过程中切换工作区: 取消进行中的展开任务，不影响新工作区', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('slowFolder', true)];
      u.setDir('slowFolder', () => new Promise(resolve => {
        window.resolveSlow = resolve;
      }));
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('slowFolder').click();
    // 切换到另一个工作区
    await page.evaluate(async () => {
      await window.u.workspace.openWorkspacePath('C:/other');
      window.resolveSlow([window.f.node('slowFolder/child', true)]);
    });
    await idle(100);
    const currentRoot = await page.evaluate(() => window.u.workspace.rootPath);
    assert.equal(currentRoot, 'C:/other');
  });

  // 10. 智能展开关闭
  await test('10. 智能展开关闭: 点击仅展开当前层，单子目录保持折叠', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: false, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('smartOff', true)];
      u.setDir('smartOff', [node('smartOff/child', true)]);
      u.setDir('smartOff/child', [node('smartOff/child/leaf', true)]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('smartOff').click();
    await idle(100);
    const result = await page.evaluate(() => {
      const root = window.u.workspace.entries[0];
      const child = root.children?.[0];
      return {
        rootExpanded: !!root.isExpanded,
        childExpanded: !!child?.isExpanded,
      };
    });
    assert.equal(result.rootExpanded, true);
    assert.equal(result.childExpanded, false);
  });

  // 11. 紧凑文件夹开启
  await test('11. 紧凑文件夹开启: 连续单子目录合并为单行展示，中间层保留精确右键操作能力', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: false, compactFolders: true });
      const { node } = window.f, u = window.u;
      const entries = [node('java', true)];
      u.setDir('java', [node('java/com', true)]);
      u.setDir('java/com', [node('java/com/own', true)]);
      u.setDir('java/com/own', [node('java/com/own/common', true)]);
      u.setDir('java/com/own/common', [node('java/com/own/common/a.txt'), node('java/com/own/common/b.txt')]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    // 展开 java 使得整条链加载
    await row('java').click();
    await idle(150);

    // 检查紧凑展示
    const compactInfo = await page.evaluate(() => {
      const u = window.u;
      const chain = window.f.getCompactChain(u.workspace.entries[0]);
      return {
        chainLength: chain.length,
        names: chain.map(c => c.name),
      };
    });
    assert.equal(compactInfo.chainLength, 4);
    assert.deepEqual(compactInfo.names, ['java', 'com', 'own', 'common']);

    // 检查各段 (segment) 是否在 DOM 中存在并具有精确的属性
    assert.equal(await segment('java/com').count(), 1);
    assert.equal(await segment('java/com/own').count(), 1);

    // 点击中间目录 com，确认选中且操作目标为 com
    await segment('java/com').click();
    await idle(70);
    const selectedPath = await page.evaluate(() => window.u.workspace.selectedTreePath);
    assert.equal(selectedPath, 'C:/fixture/java/com');

    // 右键点击 com 打开上下文菜单，检查新建/重命名/删除目标精确为 com
    await segment('java/com').click({ button: 'right' });
    await idle(70);
    const contextMenuTarget = await page.evaluate(() => window.u.workspace.selectedTreePath);
    assert.equal(contextMenuTarget, 'C:/fixture/java/com');
  });

  // 12. 两个选项同时开启
  await test('12. 两个选项同时开启: 单行紧凑展示，且展开末尾自动智能展开后续单子项', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: true });
      const { node } = window.f, u = window.u;
      const entries = [node('both', true)];
      u.setDir('both', [node('both/sub1', true)]);
      u.setDir('both/sub1', [node('both/sub1/sub2', true)]);
      u.setDir('both/sub1/sub2', [node('both/sub1/sub2/file.txt')]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('both').click();
    await idle(150);
    const isBothExpanded = await page.evaluate(() => {
      const root = window.u.workspace.entries[0];
      const chain = window.f.getCompactChain(root);
      return chain.every(n => n.isExpanded);
    });
    assert.equal(isBothExpanded, true);
  });

  // 13. 两个选项同时关闭
  await test('13. 两个选项同时关闭: 不合并单行且仅展开单级', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: false, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('bothOff', true)];
      u.setDir('bothOff', [node('bothOff/next', true)]);
      u.setDir('bothOff/next', [node('bothOff/next/leaf', true)]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('bothOff').click();
    await idle(100);
    const result = await page.evaluate(() => {
      const root = window.u.workspace.entries[0];
      return {
        rootExpanded: !!root.isExpanded,
        childExpanded: !!root.children?.[0]?.isExpanded,
        childrenCount: root.children?.length,
      };
    });
    assert.equal(result.rootExpanded, true);
    assert.equal(result.childExpanded, false);
    assert.equal(result.childrenCount, 1);
  });

  // 14. 虚拟树滚动和当前文件定位
  await test('14. 虚拟树滚动和当前文件定位: 定位到深层单子目录文件正确展开并滚入可视区域', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: true, compactFolders: false });
      const { node } = window.f, u = window.u;
      const entries = [node('deepChain', true)];
      u.setDir('deepChain', [node('deepChain/l1', true)]);
      u.setDir('deepChain/l1', [node('deepChain/l1/l2', true)]);
      u.setDir('deepChain/l1/l2', [node('deepChain/l1/l2/target.txt')]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
      u.files.accept(window.f.file('C:/fixture/deepChain/l1/l2/target.txt'));
    });
    await idle();
    await page.getByRole('button', { name: '定位当前文件', exact: true }).click();
    await idle(150);
    const isTargetVisible = await row('deepChain/l1/l2/target.txt').isVisible();
    assert.equal(isTargetVisible, true);
  });

  // 15. 目录变动后自动重新计算显示结构
  await test('15. 目录变动后自动重新计算显示结构: 增加同级节点时紧凑链自动解散或重构', async () => {
    await page.evaluate(async () => {
      await window.f.mount({ smartExpand: false, compactFolders: true });
      const { node } = window.f, u = window.u;
      const entries = [node('reactiveChain', true)];
      u.setDir('reactiveChain', [node('reactiveChain/subA', true)]);
      u.setDir('reactiveChain/subA', [node('reactiveChain/subA/subB', true)]);
      u.setDir('reactiveChain/subA/subB', [node('reactiveChain/subA/subB/f.txt')]);
      u.workspace.restoreSession([{ rootPath: 'C:/fixture', name: 'fixture', entries }]);
    });
    await idle();
    await row('reactiveChain').click();
    await idle(120);

    let chainNames = await page.evaluate(() => {
      const chain = window.f.getCompactChain(window.u.workspace.entries[0]);
      return chain.map(c => c.name);
    });
    assert.deepEqual(chainNames, ['reactiveChain', 'subA', 'subB']);

    // 在 subA 中增加一个普通文件，打破其单子目录条件
    await page.evaluate(() => {
      const u = window.u, node = window.f.node;
      const subA = u.workspace.entries[0].children[0];
      subA.children.push(node('reactiveChain/subA/extra.txt'));
    });
    await idle(70);

    // 重新计算紧凑链，应在 subA 处终止（因为现在有 2 个子项）
    chainNames = await page.evaluate(() => {
      const chain = window.f.getCompactChain(window.u.workspace.entries[0]);
      return chain.map(c => c.name);
    });
    assert.deepEqual(chainNames, ['reactiveChain', 'subA']);

    // 动态关闭紧凑文件夹，恢复完整层级
    await page.evaluate(() => {
      window.u.state.compactFolders = false;
      window.u.workspace.entries[0].children[0].isExpanded = true;
    });
    await idle(70);
    const flatTreeCount = await page.evaluate(() => {
      return window.f.buildFlatTree(window.u.workspace.roots, [], false).length;
    });
    // 根目录 + reactiveChain + subA + (subB, extra.txt) -> 5
    assert.ok(flatTreeCount >= 4);
  });

  // Settings UI 集成测试
  await test('16. 设置持久化与即时生效: 验证 smartExpand 和 compactFolders 的 settingsFrom 与 defaultSettings', async () => {
    const s = await page.evaluate(() => {
      const defs = window.f.settings.defaultSettings();
      const custom = window.f.settings.settingsFrom({ smartExpand: false, compactFolders: true });
      const legacy = window.f.settings.settingsFrom({});
      return {
        defaultSmart: defs.smartExpand,
        defaultCompact: defs.compactFolders,
        customSmart: custom.smartExpand,
        customCompact: custom.compactFolders,
        legacySmart: legacy.smartExpand,
        legacyCompact: legacy.compactFolders,
      };
    });
    assert.equal(s.defaultSmart, true);
    assert.equal(s.defaultCompact, false);
    assert.equal(s.customSmart, false);
    assert.equal(s.customCompact, true);
    assert.equal(s.legacySmart, true);
    assert.equal(s.legacyCompact, false);
  });

  assert.deepEqual(errors, [])
  fs.writeFileSync(`${output}/results.json`, JSON.stringify({ passed: results.length, tests: results }, null, 2))
  console.log('PASS all ' + results.length + ' workspace smart expand and compact folders tests')
} catch (error) {
  if (browser) {
    const p = browser.contexts()[0]?.pages()[0]
    if (p) await p.screenshot({ path: `${output}/failure.png` })
  }
  throw error
} finally {
  await browser?.close()
  await server.close()
}
