; installer.nsh — 自定义 NSIS 安装逻辑（electron-builder 经 nsis.include 引入此文件）
;
; 在安装器初始化(customInit)阶段检测是否已安装旧版本：
;   - 首次安装：不弹框，正常进入向导让用户选择安装路径
;   - 已安装旧版：弹出中文确认框
;       “是” → 继续；随后的安装段(installSection)会自动卸载旧版并安装新版，即覆盖安装
;       “否” → Abort 退出安装器，什么都不动
;
; 注册表检测位置(${UNINSTALL_REGISTRY_KEY} + SHELL_CONTEXT)与 electron-builder
; 自带的卸载检测完全一致，保证一定能读到旧版信息；并且 customInit 早于卸载动作，读取有效。
;
; 留痕截图保护：
;   electron-builder 默认卸载器会 RMDir /r $INSTDIR 递归删除整个安装目录，
;   升级(isUpdated)时也会把旧目录改名后删除——留痕截图在里面会被一并删掉。
;   因此在删除之前(customUnInstall)先把「留痕截图」暂存到 %LOCALAPPDATA%\AI评论助手\，
;   升级完成后(customInstall)再移回新安装目录；主动卸载时则留在暂存位置并提示用户。

!macro customInit
  ; 读取旧版卸载信息（perMachine:false 时 SHELL_CONTEXT 解析为 HKCU）
  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"

  ; $0 为空 = 未检测到旧版，直接跳到结尾走正常流程（首次安装）
  StrCmp $0 "" initDone 0

    ; 检测到旧版，询问是否覆盖
    MessageBox MB_YESNO|MB_ICONQUESTION "检测到已安装旧版本的 ${PRODUCT_FILENAME}。$\n$\n是否执行覆盖安装？（将自动卸载旧版本，你的 AI 配置、登录状态、运行日志和留痕截图会保留）" IDYES initDone

    ; 用户选“否”，中止安装
    Abort

  initDone:
!macroend

; 卸载器：在 RMDir /r $INSTDIR 之前把留痕截图移出安装目录，避免被整体删除。
; 升级与主动卸载都会走这里；升级时 customInstall 会把它移回原位。
!macro customUnInstall
  SetShellVarContext current
  ${if} ${FileExists} "$INSTDIR\留痕截图"
    CreateDirectory "$LOCALAPPDATA\AI评论助手"
    ${ifNot} ${FileExists} "$LOCALAPPDATA\AI评论助手\留痕截图"
      Rename "$INSTDIR\留痕截图" "$LOCALAPPDATA\AI评论助手\留痕截图"
    ${endif}
  ${endif}

  ; 主动卸载时提示保留位置；升级触发的静默卸载不弹窗。
  ${ifNot} ${isUpdated}
    ${if} ${FileExists} "$LOCALAPPDATA\AI评论助手\留痕截图"
      MessageBox MB_OK|MB_ICONINFORMATION "卸载完成。$\n$\n你的留痕截图证据已保留在：$\n$LOCALAPPDATA\AI评论助手\留痕截图$\n$\n如需彻底删除，请手动删除该目录。"
    ${endif}
  ${endif}
!macroend

; 安装器：升级完成后把暂存的留痕截图移回新安装目录（首次安装时暂存目录不存在，自动跳过）。
!macro customInstall
  SetShellVarContext current
  ${if} ${FileExists} "$LOCALAPPDATA\AI评论助手\留痕截图"
    ${ifNot} ${FileExists} "$INSTDIR\留痕截图"
      CreateDirectory "$INSTDIR"
      Rename "$LOCALAPPDATA\AI评论助手\留痕截图" "$INSTDIR\留痕截图"
    ${endif}
  ${endif}
!macroend
