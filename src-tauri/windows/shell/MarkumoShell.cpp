#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <atomic>
#include <filesystem>
#include <string>
#include <vector>
#include <new>

// Stable across updates; identical to the sparse package COM registration.
const CLSID CLSID_MarkumoCommand={0xb9956a39,0x81ca,0x4eae,{0xa7,0x37,0x73,0x85,0x64,0xba,0xfd,0x26}};
static HMODULE moduleHandle;
static std::atomic<long> objects{0},locks{0};
static std::wstring appPath(){
  std::vector<wchar_t> path(32768);
  auto n=GetModuleFileNameW(moduleHandle,path.data(),static_cast<DWORD>(path.size()));
  if(!n||n>=path.size())return {};
  return (std::filesystem::path(path.data()).parent_path().parent_path()/L"markumo.exe").wstring();
}
// Windows command-line quoting, including backslashes before quotes/end.
static std::wstring quoteArg(const std::wstring& value){
  std::wstring result=L"\"";size_t slashes=0;
  for(wchar_t c:value){
    if(c==L'\\'){slashes++;continue;}
    if(c==L'\"')result.append(slashes*2+1,L'\\');else result.append(slashes,L'\\');
    result+=c;slashes=0;
  }
  result.append(slashes*2,L'\\');result+=L'\"';return result;
}
static HRESULT launch(const std::wstring& app,std::wstring command){
  STARTUPINFOW startup{sizeof(startup)};PROCESS_INFORMATION process{};
  auto directory=std::filesystem::path(app).parent_path().wstring();
  if(!CreateProcessW(app.c_str(),command.data(),nullptr,nullptr,FALSE,0,nullptr,directory.c_str(),&startup,&process))return HRESULT_FROM_WIN32(GetLastError());
  CloseHandle(process.hThread);CloseHandle(process.hProcess);return S_OK;
}
class Command final:public IExplorerCommand{
  std::atomic<ULONG> refs{1};
public:
  Command(){objects++;}~Command(){objects--;}
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** result)override{
    if(!result)return E_POINTER;*result=nullptr;
    if(id==IID_IUnknown||id==__uuidof(IExplorerCommand)){*result=static_cast<IExplorerCommand*>(this);AddRef();return S_OK;}return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}
  ULONG STDMETHODCALLTYPE Release()override{auto count=--refs;if(!count)delete this;return count;}
  HRESULT STDMETHODCALLTYPE GetTitle(IShellItemArray*,LPWSTR* title)override{return SHStrDupW(L"以 Markumo 打开",title);}
  HRESULT STDMETHODCALLTYPE GetIcon(IShellItemArray*,LPWSTR* icon)override{return SHStrDupW((L"\""+appPath()+L"\",0").c_str(),icon);}
  HRESULT STDMETHODCALLTYPE GetToolTip(IShellItemArray*,LPWSTR* value)override{if(!value)return E_POINTER;*value=nullptr;return E_NOTIMPL;}
  HRESULT STDMETHODCALLTYPE GetCanonicalName(GUID* id)override{if(!id)return E_POINTER;*id=CLSID_MarkumoCommand;return S_OK;}
  HRESULT STDMETHODCALLTYPE GetState(IShellItemArray* items,BOOL,EXPCMDSTATE* state)override{
    if(!state)return E_POINTER;*state=ECS_HIDDEN;
    DWORD count=0;if(!items||FAILED(items->GetCount(&count))||!count)return S_OK;
    IShellItem* item=nullptr;
    if(SUCCEEDED(items->GetItemAt(0,&item))){SFGAOF flags=0;auto hr=item->GetAttributes(SFGAO_FILESYSTEM|SFGAO_FOLDER,&flags);item->Release();if(SUCCEEDED(hr)&&(flags&SFGAO_FILESYSTEM)&&!(flags&SFGAO_FOLDER))*state=ECS_ENABLED;}
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE Invoke(IShellItemArray* items,IBindCtx*)override{
    if(!items)return E_INVALIDARG;
    try{
      auto app=appPath();if(app.empty())return E_FAIL;
      DWORD count=0;auto hr=items->GetCount(&count);if(FAILED(hr))return hr;
      const auto base=quoteArg(app);auto command=base;
      for(DWORD i=0;i<count;i++){
        IShellItem* item=nullptr;hr=items->GetItemAt(i,&item);if(FAILED(hr))return hr;
        PWSTR path=nullptr;hr=item->GetDisplayName(SIGDN_FILESYSPATH,&path);item->Release();if(FAILED(hr))return hr;
        std::wstring argument;try{argument=L" "+quoteArg(path);}catch(...){CoTaskMemFree(path);throw;}CoTaskMemFree(path);
        if(base.size()+argument.size()>30000)return E_INVALIDARG;
        if(command.size()+argument.size()>30000){hr=launch(app,command);if(FAILED(hr))return hr;command=base;}
        command+=argument;
      }
      return command==base?S_OK:launch(app,command);
    }catch(const std::bad_alloc&){return E_OUTOFMEMORY;}catch(...){return E_FAIL;}
  }
  HRESULT STDMETHODCALLTYPE GetFlags(EXPCMDFLAGS* flags)override{if(!flags)return E_POINTER;*flags=ECF_DEFAULT;return S_OK;}
  HRESULT STDMETHODCALLTYPE EnumSubCommands(IEnumExplorerCommand** value)override{if(!value)return E_POINTER;*value=nullptr;return E_NOTIMPL;}
};
class Factory final:public IClassFactory{
  std::atomic<ULONG> refs{1};
public:
  Factory(){objects++;}~Factory(){objects--;}
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** result)override{if(!result)return E_POINTER;*result=nullptr;if(id==IID_IUnknown||id==IID_IClassFactory){*result=this;AddRef();return S_OK;}return E_NOINTERFACE;}
  ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}
  ULONG STDMETHODCALLTYPE Release()override{auto count=--refs;if(!count)delete this;return count;}
  HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer,REFIID id,void** result)override{if(!result)return E_POINTER;*result=nullptr;if(outer)return CLASS_E_NOAGGREGATION;auto command=new(std::nothrow) Command;if(!command)return E_OUTOFMEMORY;auto hr=command->QueryInterface(id,result);command->Release();return hr;}
  HRESULT STDMETHODCALLTYPE LockServer(BOOL lock)override{if(lock)locks++;else locks--;return S_OK;}
};
extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid,REFIID id,void** result){
  if(!result)return E_POINTER;*result=nullptr;if(clsid!=CLSID_MarkumoCommand)return CLASS_E_CLASSNOTAVAILABLE;
  auto factory=new(std::nothrow) Factory;if(!factory)return E_OUTOFMEMORY;auto hr=factory->QueryInterface(id,result);factory->Release();return hr;
}
extern "C" HRESULT __stdcall DllCanUnloadNow(){return objects==0&&locks==0?S_OK:S_FALSE;}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH){moduleHandle=instance;DisableThreadLibraryCalls(instance);}return TRUE;}
#ifdef MARKUMO_SHELL_TEST
#include <cassert>
int wmain(){
  assert(quoteArg(L"C:\\中文 路径\\a.txt")==L"\"C:\\中文 路径\\a.txt\"");
  assert(quoteArg(L"tail\\")==L"\"tail\\\\\"");
  assert(quoteArg(L"a\"b")==L"\"a\\\"b\"");
  IClassFactory* factory=nullptr;assert(SUCCEEDED(DllGetClassObject(CLSID_MarkumoCommand,IID_PPV_ARGS(&factory))));
  IExplorerCommand* command=nullptr;assert(SUCCEEDED(factory->CreateInstance(nullptr,IID_PPV_ARGS(&command))));factory->Release();
  PWSTR title=nullptr;assert(SUCCEEDED(command->GetTitle(nullptr,&title)));assert(std::wstring(title)==L"以 Markumo 打开");CoTaskMemFree(title);
  EXPCMDSTATE state;assert(SUCCEEDED(command->GetState(nullptr,FALSE,&state))&&state==ECS_HIDDEN);
  GUID name;assert(SUCCEEDED(command->GetCanonicalName(&name))&&name==CLSID_MarkumoCommand);
  assert(command->Invoke(nullptr,nullptr)==E_INVALIDARG);assert(DllCanUnloadNow()==S_FALSE);command->Release();assert(DllCanUnloadNow()==S_OK);
  return 0;
}
#endif
