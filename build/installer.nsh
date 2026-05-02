; Konomi installer/uninstaller diagnostic log.
;
; Writes a timestamped line to %TEMP%\konomi-installer.log at every NSIS
; lifecycle hook electron-builder exposes. The Electron app is already dead
; once the NSIS process is running, so the only way to see how far the
; installer progressed before a hang is to log from inside NSIS itself.
;
; Reading the log:
;   - Last line shows how far the installer got.
;   - Long gap between two consecutive timestamps marks the hang location.
;
; Hook order (install):
;   preInit -> customInit -> customInstallMode -> (extract files) -> customInstall
; Hook order (uninstall, also runs silently when a newer installer upgrades):
;   customUnInit -> customRemoveFiles before -> (RMDir /r) -> customRemoveFiles after -> customUnInstall

!include "FileFunc.nsh"

!define KONOMI_INSTALLER_LOG "$TEMP\konomi-installer.log"

!macro KonomiLog Tag
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R9
  ${GetTime} "" "L" $R0 $R1 $R2 $R3 $R4 $R5 $R6
  FileOpen $R9 "${KONOMI_INSTALLER_LOG}" a
  FileSeek $R9 0 END
  FileWrite $R9 "[$R2-$R1-$R0 $R4:$R5:$R6] ${Tag}$\r$\n"
  FileClose $R9
  Pop $R9
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro preInit
  !insertmacro KonomiLog "preInit"
!macroend

!macro customInit
  !insertmacro KonomiLog "customInit"
!macroend

!macro customInstallMode
  !insertmacro KonomiLog "customInstallMode"
!macroend

!macro customInstall
  !insertmacro KonomiLog "customInstall (install section end, $INSTDIR populated)"
!macroend

!macro customUnInit
  !insertmacro KonomiLog "customUnInit"
!macroend

!macro customRemoveFiles
  !insertmacro KonomiLog "customRemoveFiles before RMDir of $INSTDIR"
  RMDir /r "$INSTDIR"
  !insertmacro KonomiLog "customRemoveFiles after RMDir of $INSTDIR"
!macroend

!macro customUnInstall
  !insertmacro KonomiLog "customUnInstall (uninstall section end)"
!macroend
