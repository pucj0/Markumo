import { describe, it, expect, vi } from 'vitest'
import { WindowCloseGuard, type CloseStatus } from '../src/features/shell/WindowCloseGuard'

function setup() {
  const status: CloseStatus = { fileBusy:false,savingCount:0,composing:false,dirtyCount:0,documentCount:0,activePane:'main',hasActiveDocument:false }
  const services = { status:()=>({...status}),flush:vi.fn(async()=>{}),confirmDirty:vi.fn(),destroy:vi.fn(async()=>{}),blocked:vi.fn(),failed:vi.fn(),diagnose:vi.fn() }
  return {status,services,guard:new WindowCloseGuard(services)}
}
describe('Phase A native close handshake',()=>{
  it('Empty editor closes normally, with source and metadata-only diagnostics',async()=>{
    const {guard,services}=setup();await guard.request('titlebar')
    expect(services.destroy).toHaveBeenCalledOnce();expect(services.blocked).not.toHaveBeenCalled()
    expect(services.diagnose.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({source:'titlebar',stage:'destroy',hasActiveDocument:false}))
  })
  it.each(['fileBusy','savingCount','composing'] as const)('%s prevents closing; retry after completion works',async key=>{
    const {guard,status,services}=setup()
    if(key==='savingCount')status[key]=1;else status[key]=true
    await guard.request('native');expect(services.destroy).not.toHaveBeenCalled()
    if(key==='savingCount')status[key]=0;else status[key]=false
    await guard.request('native');expect(services.destroy).toHaveBeenCalledOnce()
  })
  it('Rechecks dirty and saving after asynchronous settings flush',async()=>{
    const {guard,status,services}=setup()
    services.flush.mockImplementationOnce(async()=>{status.savingCount=1})
    await guard.request('command');expect(services.destroy).not.toHaveBeenCalled()
    status.savingCount=0;status.dirtyCount=1
    await guard.request('command');expect(services.confirmDirty).toHaveBeenCalledOnce();expect(services.destroy).not.toHaveBeenCalled()
  })
  it('Concurrent close requests have one flush, confirmation and destruction',async()=>{
    const {guard,services}=setup();let finish!:()=>void
    services.flush.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve}))
    const first=guard.request('titlebar'),second=guard.request('native')
    expect(first).toBe(second);finish();await first
    expect(services.flush).toHaveBeenCalledOnce();expect(services.destroy).toHaveBeenCalledOnce()
  })
  it('Failed flush/destroy retain window and can be retried',async()=>{
    const {guard,services}=setup();services.destroy.mockRejectedValueOnce(new Error('denied'))
    await guard.request('native');expect(services.failed).toHaveBeenCalledOnce()
    await guard.request('native');expect(services.destroy).toHaveBeenCalledTimes(2)
  })
})
