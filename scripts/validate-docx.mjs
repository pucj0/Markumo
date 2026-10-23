import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const output=path.resolve('test-results/docx-validator')
fs.mkdirSync(output,{recursive:true})
const temporary=path.join(output,'temp');fs.mkdirSync(temporary,{recursive:true})
const env={...process.env,TEMP:temporary,TMP:temporary,TMPDIR:temporary,DOTNET_CLI_TELEMETRY_OPTOUT:'1'}
const project=path.resolve('scripts/openxml-validator')
const run=args=>spawnSync('dotnet',args,{env,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024})
const restored=run(['restore',project,'--locked-mode'])
fs.writeFileSync(path.join(output,'restore.log'),restored.stdout+restored.stderr)
assert.equal(restored.status,0,restored.stdout+restored.stderr)
const files=process.argv.slice(2)
const positives=files.length?files:['test-results/native-export-repair03.docx','test-results/docx-worker/complex.docx']
for(const file of positives)assert(fs.existsSync(file),'Missing generated DOCX: '+file)
const result=run(['run','--project',project,'--no-restore','--',...positives])
fs.writeFileSync(path.join(output,'positive.json'),result.stdout)
assert.equal(result.status,0,result.stdout+result.stderr)
const negative='test-results/native-export-invalid-schema.docx'
assert(fs.existsSync(negative),'Missing schema negative control')
const rejected=run(['run','--project',project,'--no-restore','--no-build','--',negative])
fs.writeFileSync(path.join(output,'negative.json'),rejected.stdout)
assert.equal(rejected.status,1,'Validator must reject the malformed table package: '+rejected.stdout+rejected.stderr)
assert(rejected.stdout.includes('Sch_UnexpectedElementContentExpectingComplex'),'Negative control must fail on the missing table grid, not environment/setup problems')
console.log('PASS Microsoft Open XML SDK 3.3.0 Office2016 validation: '+positives.length+' DOCX packages; malformed-schema negative control rejected')
