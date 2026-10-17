; ==============================================================================
; Markumo Windows File Associations & Context Menu NSIS Hooks
; ==============================================================================
; This script hooks into Tauri 2's NSIS installer to register Markumo with
; the Windows Shell (Open With, Default Apps, Context Menu) safely without
; hijacking user's existing default applications.
; All newly registered ProgIDs, capabilities and shell verb IDs use Markumo.
; ==============================================================================

; Override Tauri's default APP_ASSOCIATE to prevent overwriting default application handlers
; Tauri includes FileAssociation.nsh before these hooks. Macros have a separate
; namespace from !define symbols, so !ifdef/!undef cannot replace them.
!ifmacrodef APP_ASSOCIATE
  !macroundef APP_ASSOCIATE
!endif
!macro APP_ASSOCIATE EXT FILECLASS DESCRIPTION ICON COMMANDTEXT COMMAND
  ; 1. Register independent application ProgID
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}" "" `${DESCRIPTION}`
  ; Documents use a paper icon; application shortcuts and Open With keep the M logo.
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}\DefaultIcon" "" '"$INSTDIR\icons\document.ico",0'
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}\shell\open" "" `${COMMANDTEXT}`
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}\shell\open\command" "" `${COMMAND}`

  ; 2. Add to OpenWithProgids without modifying the default value of .${EXT}
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}" ""
!macroend

!ifmacrodef APP_UNASSOCIATE
  !macroundef APP_UNASSOCIATE
!endif
!macro APP_UNASSOCIATE EXT FILECLASS
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}"
  DeleteRegKey SHCTX `Software\Classes\${FILECLASS}`
!macroend

; Editing a Windows executable script must not change its double-click execution.
!macro Markumo_RegisterEditVerb EXT
  ; Windows Context Menu: "使用 Markumo 打开" (Windows 10 standard & Windows 11 Show More Options)
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\Markumo" "" "使用 Markumo 打开"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\Markumo" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\Markumo\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ; One global file verb below avoids duplicate entries for known extensions.
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\Markumo" "LegacyDisable" ""
!macroend

; Macro to register a document extension with Open With, Capabilities, and Context Menu
!macro Markumo_RegisterExt EXT
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHCTX "Software\Markumo\Capabilities\FileAssociations" ".${EXT}" "Markumo.Document"
  !insertmacro Markumo_RegisterEditVerb "${EXT}"
!macroend

; Remove only our legacy candidates, then let the machine's batfile/cmdfile
; association take effect. Never write a default or remove another app's values.
!macro Markumo_RegisterExecutableScript EXT
  ReadRegStr $R0 SHCTX "Software\Classes\Source Code File" ""
  ${If} $R0 == "源代码文件 (LightEdit)"
  ${OrIf} $R0 == "源代码文件 (Markumo)"
    DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "Source Code File"
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "Markumo.Document"
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "LightEdit.Document"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}"
  DeleteRegValue SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}"
  DeleteRegValue SHCTX "Software\Markumo\Capabilities\FileAssociations" ".${EXT}"
  !insertmacro Markumo_RegisterEditVerb "${EXT}"
!macroend

; Macro to unregister one file extension
!macro Markumo_UnregisterExt EXT
  DeleteRegValue SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}"
  DeleteRegValue SHCTX "Software\Markumo\Capabilities\FileAssociations" ".${EXT}"
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\Markumo"
  DeleteRegKey /ifempty SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell"
  DeleteRegKey /ifempty SHCTX "Software\Classes\SystemFileAssociations\.${EXT}"
!macroend

; ------------------------------------------------------------------------------
; Post-Install Hook: Runs after files and basic shortcuts are created
; ------------------------------------------------------------------------------
!macro NSIS_HOOK_POSTINSTALL
  ; Replace only our old RegisteredApplications display entry.
  ReadRegStr $R0 SHCTX "Software\RegisteredApplications" "LightEdit"
  ${If} $R0 == "Software\LightEdit\Capabilities"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "LightEdit"
  ${EndIf}
  ; 1. Applications\markumo.exe registration for Windows Open With list
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open" "" "使用 Markumo 打开"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  ; 2. Generic Markumo.Document ProgID definition for Default Apps
  WriteRegStr SHCTX "Software\Classes\Markumo.Document" "" "Markumo 文本文档"
  WriteRegStr SHCTX "Software\Classes\Markumo.Document\DefaultIcon" "" '"$INSTDIR\icons\document.ico",0'
  WriteRegStr SHCTX "Software\Classes\Markumo.Document\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\Markumo.Document\shell\open" "" "使用 Markumo 打开"
  WriteRegStr SHCTX "Software\Classes\Markumo.Document\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  ; 3. Windows RegisteredApplications capabilities (Windows 10/11 Default Apps settings)
  WriteRegStr SHCTX "Software\Markumo\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Markumo\Capabilities" "ApplicationDescription" "Markumo 轻量文本与 Markdown 编辑器"
  WriteRegStr SHCTX "Software\Markumo\Capabilities" "ApplicationIcon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\Markumo\Capabilities"

  ; 4. SystemFileAssociations for generic text
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\text\shell\Markumo" "" "使用 Markumo 打开"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\text\shell\Markumo" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\text\shell\Markumo\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\text\shell\Markumo" "LegacyDisable" ""

  ; Any file, including extensions without PerceivedType=text. This is the
  ; classic menu (Windows 11: Show more options), not a modern Shell extension.
  WriteRegStr SHCTX "Software\Classes\*\shell\Markumo" "" "以 Markumo 打开"
  WriteRegStr SHCTX "Software\Classes\*\shell\Markumo" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\*\shell\Markumo" "MultiSelectModel" "Document"
  WriteRegStr SHCTX "Software\Classes\*\shell\Markumo\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  ; 5. Register 27 document extensions; executable scripts get an edit verb only
  !insertmacro Markumo_RegisterExt "txt"
  !insertmacro Markumo_RegisterExt "md"
  !insertmacro Markumo_RegisterExt "markdown"
  !insertmacro Markumo_RegisterExt "json"
  !insertmacro Markumo_RegisterExt "jsonc"
  !insertmacro Markumo_RegisterExt "xml"
  !insertmacro Markumo_RegisterExt "yaml"
  !insertmacro Markumo_RegisterExt "yml"
  !insertmacro Markumo_RegisterExt "js"
  !insertmacro Markumo_RegisterExt "jsx"
  !insertmacro Markumo_RegisterExt "ts"
  !insertmacro Markumo_RegisterExt "tsx"
  !insertmacro Markumo_RegisterExt "vue"
  !insertmacro Markumo_RegisterExt "html"
  !insertmacro Markumo_RegisterExt "css"
  !insertmacro Markumo_RegisterExt "scss"
  !insertmacro Markumo_RegisterExt "java"
  !insertmacro Markumo_RegisterExt "py"
  !insertmacro Markumo_RegisterExt "go"
  !insertmacro Markumo_RegisterExt "rs"
  !insertmacro Markumo_RegisterExt "sql"
  !insertmacro Markumo_RegisterExt "log"
  !insertmacro Markumo_RegisterExt "ini"
  !insertmacro Markumo_RegisterExt "cfg"
  !insertmacro Markumo_RegisterExt "conf"
  !insertmacro Markumo_RegisterExt "properties"
  !insertmacro Markumo_RegisterExt "sh"
  !insertmacro Markumo_RegisterExecutableScript "bat"
  !insertmacro Markumo_RegisterExecutableScript "cmd"

  ; 6. Notify Windows Shell of association updates
  System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

; ------------------------------------------------------------------------------
; Pre-Uninstall Hook: Runs before removing files and directories
; ------------------------------------------------------------------------------
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\*\shell\Markumo"
  ; 1. Remove Windows RegisteredApplications reference
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"

  ; 2. Remove Capabilities
  DeleteRegKey SHCTX "Software\Markumo\Capabilities"
  DeleteRegKey /ifempty SHCTX "Software\Markumo"

  ; 3. Remove Applications\markumo.exe
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"

  ; 4. Remove Generic ProgID
  DeleteRegKey SHCTX "Software\Classes\Markumo.Document"

  ; 5. Remove SystemFileAssociations for generic text
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\text\shell\Markumo"
  DeleteRegKey /ifempty SHCTX "Software\Classes\SystemFileAssociations\text\shell"
  DeleteRegKey /ifempty SHCTX "Software\Classes\SystemFileAssociations\text"

  ; 6. Unregister all 29 supported extensions
  !insertmacro Markumo_UnregisterExt "txt"
  !insertmacro Markumo_UnregisterExt "md"
  !insertmacro Markumo_UnregisterExt "markdown"
  !insertmacro Markumo_UnregisterExt "json"
  !insertmacro Markumo_UnregisterExt "jsonc"
  !insertmacro Markumo_UnregisterExt "xml"
  !insertmacro Markumo_UnregisterExt "yaml"
  !insertmacro Markumo_UnregisterExt "yml"
  !insertmacro Markumo_UnregisterExt "js"
  !insertmacro Markumo_UnregisterExt "jsx"
  !insertmacro Markumo_UnregisterExt "ts"
  !insertmacro Markumo_UnregisterExt "tsx"
  !insertmacro Markumo_UnregisterExt "vue"
  !insertmacro Markumo_UnregisterExt "html"
  !insertmacro Markumo_UnregisterExt "css"
  !insertmacro Markumo_UnregisterExt "scss"
  !insertmacro Markumo_UnregisterExt "java"
  !insertmacro Markumo_UnregisterExt "py"
  !insertmacro Markumo_UnregisterExt "go"
  !insertmacro Markumo_UnregisterExt "rs"
  !insertmacro Markumo_UnregisterExt "sql"
  !insertmacro Markumo_UnregisterExt "log"
  !insertmacro Markumo_UnregisterExt "ini"
  !insertmacro Markumo_UnregisterExt "cfg"
  !insertmacro Markumo_UnregisterExt "conf"
  !insertmacro Markumo_UnregisterExt "properties"
  !insertmacro Markumo_UnregisterExt "sh"
  !insertmacro Markumo_UnregisterExt "bat"
  !insertmacro Markumo_UnregisterExt "cmd"

  ; 7. Notify Windows Shell of association removal
  System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
