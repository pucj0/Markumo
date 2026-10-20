import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = 'test-results/phase07'
const read = file => fs.existsSync(path.join(root, file)) ? JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '')) : null
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? { n: sorted.length, min: sorted[0], median: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2, max: sorted.at(-1),
    ...(sorted.length >= 20 ? { p95: sorted[Math.ceil(sorted.length * .95) - 1] } : {}) } : null
}
function memory(report) {
  if (!report) return null
  const late = report.soak.filter(sample => sample.elapsedMs >= 5 * 60000)
  const meanX = late.reduce((sum, sample) => sum + sample.elapsedMs / 60000, 0) / late.length
  const meanY = late.reduce((sum, sample) => sum + sample.heap / 1048576, 0) / late.length
  const denominator = late.reduce((sum, sample) => sum + (sample.elapsedMs / 60000 - meanX) ** 2, 0)
  const slope = denominator ? late.reduce((sum, sample) => sum + (sample.elapsedMs / 60000 - meanX) * (sample.heap / 1048576 - meanY), 0) / denominator : null
  return { passed: report.passed === true, durationMinutes: report.durationMinutes ?? report.soak.at(-1)?.elapsedMs / 60000,
    edits: report.edits ?? report.soak.at(-1)?.cycle, heapMiB: stats(report.soak.map(sample => sample.heap / 1048576)),
    afterFiveMinutes: stats(late.map(sample => sample.heap / 1048576)), slopeMiBPerMinuteAfterFive: slope,
    lifecycle: report.lifecycle, media: report.media, tabs: report.tabs }
}
function native(report) {
  if (!report) return null
  return { passed: report.passed, sha256: report.binarySha256, version: report.webviewVersion,
    scenarios: [...new Set(report.samples.map(sample => sample.scenario))].map(scenario => {
      const samples = report.samples.filter(sample => sample.scenario === scenario)
      const native = sample => sample.nativeMemory.native || sample.nativeMemory
      return { scenario, shellReadyMs: stats(samples.map(sample => sample.shellReadyMs)), interactiveMs: stats(samples.map(sample => sample.interactiveMs)),
        heapMiB: stats(samples.map(sample => sample.heap / 1048576)), nativePrivateMiB: stats(samples.map(sample => native(sample).PrivateMemorySize64 / 1048576)),
        nativeHandles: stats(samples.map(sample => native(sample).HandleCount)),
        webviewPrivateMiB: stats(samples.filter(sample => sample.nativeMemory.webviewProcessCount > 0).map(sample => sample.nativeMemory.webviewPrivateBytesSum / 1048576)) }
    }) }
}
const baseline = read('baseline-delivery-check/results.json'), verified = read('delivery-check/results.json')
const comparison = verified?.editing.map(after => {
  const before = baseline.editing.find(sample => sample.name === after.name)
  return { name: after.name, sameDataset: after.sha256 === before.sha256, lines: after.lines, chars: after.chars,
    input: { before: before.stats.input, after: after.stats.input }, undo: { before: before.stats.undo, after: after.stats.undo },
    redo: { before: before.stats.redo, after: after.stats.redo },
    undoMedianChangePercent: (after.stats.undo.median / before.stats.undo.median - 1) * 100,
    inputMedianChangePercent: (after.stats.input.median / before.stats.input.median - 1) * 100,
    maxLongTaskBefore: Math.max(0, ...before.raw.longTasks.map(sample => sample.duration)),
    maxLongTaskAfter: Math.max(0, ...after.raw.longTasks.map(sample => sample.duration)) }
})
const files = [...new Set([
  ...execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).trim().split('\n'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n'),
])].filter(file => /^(src\/|src-tauri\/src\/|scripts\/|package\.json|pnpm-lock\.yaml|\.github\/workflows\/)/.test(file) && fs.existsSync(file))
const codeManifest = files.map(file => ({ file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }))
const result = { generatedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  comparison, memory: { baseline: memory(read('baseline-clean/results.json')), final: memory(read('delivery-clean/results.json')) },
  excludedMemoryEvidence: ['baseline/results.json', 'verified/results.json', 'final/results.json'],
  excludedMemoryReason: 'Object-returning Playwright readiness predicates retained disposed view/DOM handles; use clean runs for memory conclusions.',
  native: { baseline: native(read('native-startup-baseline/results.json')), final: native(read('native-startup-final/results.json')),
    baselineRepeat: native(read('native-startup-baseline-delivery/results.json')), finalRepeat: native(read('native-startup-final-delivery/results.json')) },
  inventory: read('inventory.json'), codeManifest }
fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ comparison: comparison?.filter(sample => sample.name.startsWith('markdown')), memory: Object.fromEntries(Object.entries(result.memory).map(([label, value]) => [label, value && { passed: value.passed, durationMinutes: value.durationMinutes, edits: value.edits, heapMiB: value.heapMiB, slope: value.slopeMiBPerMinuteAfterFive }])), native: result.native }, null, 2))
