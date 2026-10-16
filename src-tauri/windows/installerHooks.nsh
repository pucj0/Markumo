; ==============================================================================
; Markumo Windows File Associations & Context Menu NSIS Hooks
; ==============================================================================
; This script hooks into Tauri 2's NSIS installer to register Markumo with
; the Windows Shell (Open With, Default Apps, Context Menu) safely without
; hijacking user's existing default applications.
; Registry ProgIDs and shell verb IDs retain LightEdit for upgrade compatibility.
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
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}\DefaultIcon" "" `${ICON}`
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
!macro LightEdit_RegisterEditVerb EXT
  ; Windows Context Menu: "使用 Markumo 打开" (Windows 10 standard & Windows 11 Show More Options)
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\LightEdit" "" "使用 Markumo 打开"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\LightEdit" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\LightEdit\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

; Macro to register a document extension with Open With, Capabilities, and Context Menu
!macro LightEdit_RegisterExt EXT
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHCTX "Software\LightEdit\Capabilities\FileAssociations" ".${EXT}" "LightEdit.Document"
  !insertmacro LightEdit_RegisterEditVerb "${EXT}"
!macroend

; Remove only our legacy candidates, then let the machine's batfile/cmdfile
; association take effect. Never write a default or remove another app's values.
!macro LightEdit_RegisterExecutableScript EXT
  ReadRegStr $R0 SHCTX "Software\Classes\Source Code File" ""
  ${If} $R0 == "源代码文件 (LightEdit)"
  ${OrIf} $R0 == "源代码文件 (Markumo)"
    DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "Source Code File"
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "LightEdit.Document"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}"
  DeleteRegValue SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}"
  DeleteRegValue SHCTX "Software\LightEdit\Capabilities\FileAssociations" ".${EXT}"
  !insertmacro LightEdit_RegisterEditVerb "${EXT}"
!macroend

; Macro to unregister one file extension
!macro LightEdit_UnregisterExt EXT
  DeleteRegValue SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}"
  DeleteRegValue SHCTX "Software\LightEdit\Capabilities\FileAssociations" ".${EXT}"
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\LightEdit"
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

  ; 2. Generic LightEdit.Document ProgID definition for Default Apps
  WriteRegStr SHCTX "Software\Classes\LightEdit.Document" "" "Markumo 文本文档"
  WriteRegStr SHCTX "Software\Classes\LightEdit.Document\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\LightEdit.Document\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\LightEdit.Document\shell\open" "" "使用 Markumo 打开"
  WriteRegStr SHCTX "Software\Classes\LightEdit.Document\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  ; 3. Windows RegisteredApplications capabilities (Windows 10/11 Default Apps settings)
  WriteRegStr SHCTX "Software\LightEdit\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\LightEdit\Capabilities" "ApplicationDescription" "Markumo 轻量文本与 Markdown 编辑器"
  WriteRegStr SHCTX "Software\LightEdit\Capabilities" "ApplicationIcon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\LightEdit\Capabilities"

  ; 4. SystemFileAssociations for generic text
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\text\shell\LightEdit" "" "使用 Markumo 打开"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\text\shell\LightEdit" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\text\shell\LightEdit\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  ; 5. Register 27 document extensions; executable scripts get an edit verb only
  !insertmacro LightEdit_RegisterExt "txt"
  !insertmacro LightEdit_RegisterExt "md"
  !insertmacro LightEdit_RegisterExt "markdown"
  !insertmacro LightEdit_RegisterExt "json"
  !insertmacro LightEdit_RegisterExt "jsonc"
  !insertmacro LightEdit_RegisterExt "xml"
  !insertmacro LightEdit_RegisterExt "yaml"
  !insertmacro LightEdit_RegisterExt "yml"
  !insertmacro LightEdit_RegisterExt "js"
  !insertmacro LightEdit_RegisterExt "jsx"
  !insertmacro LightEdit_RegisterExt "ts"
  !insertmacro LightEdit_RegisterExt "tsx"
  !insertmacro LightEdit_RegisterExt "vue"
  !insertmacro LightEdit_RegisterExt "html"
  !insertmacro LightEdit_RegisterExt "css"
  !insertmacro LightEdit_RegisterExt "scss"
  !insertmacro LightEdit_RegisterExt "java"
  !insertmacro LightEdit_RegisterExt "py"
  !insertmacro LightEdit_RegisterExt "go"
  !insertmacro LightEdit_RegisterExt "rs"
  !insertmacro LightEdit_RegisterExt "sql"
  !insertmacro LightEdit_RegisterExt "log"
  !insertmacro LightEdit_RegisterExt "ini"
  !insertmacro LightEdit_RegisterExt "cfg"
  !insertmacro LightEdit_RegisterExt "conf"
  !insertmacro LightEdit_RegisterExt "properties"
  !insertmacro LightEdit_RegisterExt "sh"
  !insertmacro LightEdit_RegisterExecutableScript "bat"
  !insertmacro LightEdit_RegisterExecutableScript "cmd"

  ; 6. Notify Windows Shell of association updates
  System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

; ------------------------------------------------------------------------------
; Pre-Uninstall Hook: Runs before removing files and directories
; ------------------------------------------------------------------------------
!macro NSIS_HOOK_PREUNINSTALL
  ; 1. Remove Windows RegisteredApplications reference
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"

  ; 2. Remove Capabilities
  DeleteRegKey SHCTX "Software\LightEdit\Capabilities"
  DeleteRegKey /ifempty SHCTX "Software\LightEdit"

  ; 3. Remove Applications\lightedit.exe
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"

  ; 4. Remove Generic ProgID
  DeleteRegKey SHCTX "Software\Classes\LightEdit.Document"

  ; 5. Remove SystemFileAssociations for generic text
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\text\shell\LightEdit"
  DeleteRegKey /ifempty SHCTX "Software\Classes\SystemFileAssociations\text\shell"
  DeleteRegKey /ifempty SHCTX "Software\Classes\SystemFileAssociations\text"

  ; 6. Unregister all 29 supported extensions
  !insertmacro LightEdit_UnregisterExt "txt"
  !insertmacro LightEdit_UnregisterExt "md"
  !insertmacro LightEdit_UnregisterExt "markdown"
  !insertmacro LightEdit_UnregisterExt "json"
  !insertmacro LightEdit_UnregisterExt "jsonc"
  !insertmacro LightEdit_UnregisterExt "xml"
  !insertmacro LightEdit_UnregisterExt "yaml"
  !insertmacro LightEdit_UnregisterExt "yml"
  !insertmacro LightEdit_UnregisterExt "js"
  !insertmacro LightEdit_UnregisterExt "jsx"
  !insertmacro LightEdit_UnregisterExt "ts"
  !insertmacro LightEdit_UnregisterExt "tsx"
  !insertmacro LightEdit_UnregisterExt "vue"
  !insertmacro LightEdit_UnregisterExt "html"
  !insertmacro LightEdit_UnregisterExt "css"
  !insertmacro LightEdit_UnregisterExt "scss"
  !insertmacro LightEdit_UnregisterExt "java"
  !insertmacro LightEdit_UnregisterExt "py"
  !insertmacro LightEdit_UnregisterExt "go"
  !insertmacro LightEdit_UnregisterExt "rs"
  !insertmacro LightEdit_UnregisterExt "sql"
  !insertmacro LightEdit_UnregisterExt "log"
  !insertmacro LightEdit_UnregisterExt "ini"
  !insertmacro LightEdit_UnregisterExt "cfg"
  !insertmacro LightEdit_UnregisterExt "conf"
  !insertmacro LightEdit_UnregisterExt "properties"
  !insertmacro LightEdit_UnregisterExt "sh"
  !insertmacro LightEdit_UnregisterExt "bat"
  !insertmacro LightEdit_UnregisterExt "cmd"

  ; 7. Notify Windows Shell of association removal
  System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
