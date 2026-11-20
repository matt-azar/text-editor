; Force desktop + Start Menu shortcuts onto a real icon after every install/update.
; Default Tauri NSIS skips recreating shortcuts on update, which leaves a stale
; .lnk / Explorer cache entry. Prefer the sidecared BMP/DIB app.ico (also fall
; back to the main EXE resource) so the shell does not show a generic document glyph.

!macro NSIS_HOOK_POSTINSTALL
  ; Sidecar copied via bundle.resources → $INSTDIR\resources\app.ico
  StrCpy $R9 "$INSTDIR\resources\app.ico"
  IfFileExists "$R9" +2 0
    StrCpy $R9 "$INSTDIR\${MAINBINARYNAME}.exe"

  ; Delete then recreate so IconFile is always rewritten on upgrade.
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$R9" 0
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$R9" 0
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$R9" 0
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif

  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$R9,0"
  ; Ask Explorer to drop cached icons for the new files.
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'
!macroend
