; Force desktop + Start Menu shortcuts onto a real icon after every install/update.
; Default Tauri NSIS skips recreating shortcuts on update, which leaves a stale
; .lnk / Explorer cache entry. Prefer the sidecared BMP/DIB app.ico (also fall
; back to the main EXE resource) so the shell does not show a generic document glyph.

!macro NSIS_HOOK_POSTINSTALL
  ; Sidecar copied via bundle.resources → $INSTDIR\resources\app.ico
  StrCpy $R9 "$INSTDIR\resources\app.ico"
  IfFileExists "$R9" +2 0
    StrCpy $R9 "$INSTDIR\${MAINBINARYNAME}.exe"

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$R9" 0
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$R9" 0
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$R9" 0
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif

  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$R9,0"
!macroend
