import { describe,it,expect,vi } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { SessionWriter,sessionInput,type SessionInput } from '../src/features/shell/launchSession'
import type { OpenFile } from '../src/features/files/contracts'
const layout={mode:'single' as const,sidebarVisible:false,sidebarWidth:254}
const input:SessionInput={kind:'single',tabs:[{token:'a',encoding:'UTF-8'}],activeToken:'a',layout}
describe('Launch/session metadata',()=>{
  it('Snapshots real open tabs in order, excluding drafts and duplicate pane references',()=>{
    const m=new DocumentManager([],async()=>[])
    const file=(token:string):OpenFile=>({token,name:token+'.txt',path:'E:/'+token+'.txt',text:token,encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'v1'})
    const a=m.openFile(file('a'))!,b=m.openFile(file('b'))!;m.createUntitled();m.select(a);m.splitEditor()
    expect(sessionInput(m,[],layout)).toEqual({kind:'single',tabs:[{token:'a',encoding:'UTF-8'},{token:'b',encoding:'UTF-8'}],activeToken:'a',layout})
    m.close(a,false,'main');m.select(b,'main');expect(sessionInput(m,[],layout).activeToken).toBe('b');m.dispose()
  })
  it('Deduplicates metadata-only updates and flushes the latest ordered snapshot',async()=>{
    const write=vi.fn(async()=>{}),writer=new SessionWriter(write,vi.fn())
    writer.prime(input);writer.schedule({...input});await writer.flush();expect(write).not.toHaveBeenCalled()
    writer.schedule({...input,activeToken:null});writer.schedule({...input,tabs:[] ,activeToken:null});await writer.flush()
    expect(write).toHaveBeenCalledOnce();expect(write).toHaveBeenCalledWith(expect.objectContaining({tabs:[]}));writer.dispose()
  })
  it('Serializes writes and coalesces changes while a save is pending',async()=>{
    let resolve!:()=>void
    const write=vi.fn().mockImplementationOnce(()=>new Promise<void>(done=>resolve=done)).mockResolvedValue(undefined)
    const writer=new SessionWriter(write,vi.fn());writer.schedule(input);const first=writer.flush();await Promise.resolve()
    writer.schedule({...input,tabs:[],activeToken:null});const second=writer.flush();expect(write).toHaveBeenCalledOnce()
    resolve();await Promise.all([first,second]);expect(write).toHaveBeenCalledTimes(2);writer.dispose()
  })
  it('Failed writes notify and permit a retry without saving any document body',async()=>{
    const failed=vi.fn(),write=vi.fn().mockRejectedValueOnce(Error('denied')).mockResolvedValue(undefined),writer=new SessionWriter(write,failed)
    writer.schedule(input);await writer.flush();expect(failed).toHaveBeenCalledOnce()
    writer.schedule(input);await writer.flush();expect(write).toHaveBeenCalledTimes(2);expect(JSON.stringify(write.mock.calls)).not.toContain('text');writer.dispose()
  })
})
