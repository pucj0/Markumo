// Archive small, reviewable acceptance evidence, never test binaries/profiles.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim()
assert.equal(git('branch','--show-current'),'main')
const output='docs/performance/repair05-evidence'
fs.mkdirSync(output,{recursive:true})
// Keep byte hashes reproducible across Windows/Linux checkouts.
fs.writeFileSync(path.join(output,'.gitattributes'),'# Raw evidence retains command-output whitespace and exact byte hashes.\n*.txt -text -whitespace\n*.json -text -whitespace\n*.png -text\n')
const files=[
 ...['toc','outline','save','migration','dialog'].flatMap(name=>['before','after'].map(stage=>`test-results/repair05-${name}-${stage}.log`)),
 'test-results/repair05-native-confirm-before.json','test-results/repair05-ooxml-before.log',
 'test-results/repair05-remote-ci.json','test-results/repair05-live-suite-before.log',
 'test-results/repair05-previous-ci-history.txt',
 'test-results/repair05-full-before.log','test-results/repair05-outline-navigation-after.log',
 'test-results/repair05-selection-before.log','test-results/repair05-toolbar-selection-after.log',
 'test-results/repair05-final-typecheck.log','test-results/repair05-final-build.log','test-results/repair05-final-rust.log',
 'test-results/repair05-real-pandoc.log',
 'test-results/repair05-final-smoke.log','test-results/repair05-final-regression.log','test-results/repair05-final-stability.log',
 'test-results/regression-smoke-summary.json','test-results/regression-regression-summary.json',
 'test-results/repair05-native/results.json','test-results/repair05-native/build.json','test-results/repair05-native/history-restored.png',
 'test-results/docx-validator/positive.json','test-results/docx-validator/negative.json','test-results/docx-worker/performance.json',
 ...['toc','outline-reorder','history','history-dialog','repair01','repair02','repair03','repair04-outline','autolink','docx-worker'].map(name=>`test-results/regression-logs/${name}-regression.log`),
]
// Historical "after" runner logs are retained alongside the final full suite's
// actual per-test logs, so subsequent additions cannot inflate old claims.
const manifest={sourceCommit:git('rev-parse','HEAD'),collectedAt:new Date().toISOString(),files:[]}
for(const source of files){
 assert(fs.existsSync(source),'Required evidence missing: '+source)
 let name=source.startsWith('test-results/repair05-native/')?'native-'+path.basename(source):path.basename(source)
 if(name.endsWith('.log'))name=name.slice(0,-4)+'.txt'
 const bytes=fs.readFileSync(source)
 fs.writeFileSync(path.join(output,name),bytes)
 manifest.files.push({source,archive:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
}
for(const source of ['test-results/regression-smoke-summary.json','test-results/regression-regression-summary.json']){
 const summary=JSON.parse(fs.readFileSync(source,'utf8'))
 assert(summary.results.every(result=>result.status==='PASS'),source+' must have no failures or skips')
}
assert.equal(JSON.parse(fs.readFileSync('test-results/repair05-native/results.json','utf8')).passed,true)
const native=JSON.parse(fs.readFileSync('test-results/repair05-native/build.json','utf8'))
for(const [source,expected] of Object.entries(native.sourceHashes))assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'),expected,'Native build differs from final source: '+source)
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2))
console.log('Archived '+files.length+' acceptance evidence files in '+output)
