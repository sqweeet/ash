Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them with the values from ProjectInfo.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
##
## For development first make a wails nsis build to populate the "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Then you can call makensis on this file with specifying the path to your binary:
## For a AMD64 only installer:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## For a ARM64 only installer:
## > makensis -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## For a installer with both architectures:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## The following information is taken from the ProjectInfo file, but they can be overwritten here.
####
!define INFO_PROJECTNAME    "Ash" # Default "{{.Name}}"
!define INFO_COMPANYNAME    "Ash" # Default "{{.Info.CompanyName}}"
!define INFO_PRODUCTNAME    "Ash" # Default "{{.Info.ProductName}}"
## !define INFO_PRODUCTVERSION "1.0.0"     # Default "{{.Info.ProductVersion}}"
## !define INFO_COPYRIGHT      "Copyright" # Default "{{.Info.Copyright}}"
###
!define PRODUCT_EXECUTABLE  "Ash.exe"      # Default "${INFO_PROJECTNAME}.exe"
# Single key "Ash" — NOT "AshAsh" from company+product concat.
!define UNINST_KEY_NAME     "Ash"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Default "admin"  see also https://nsis.sourceforge.io/Docs/Chapter4.html
####
## Include the wails tools
####
!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

SetCompressor /SOLID lzma
!include "MUI2.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Include this to add a bitmap on the left side of the Welcome Page. Must be a size of 164x314
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.
!define MUI_WELCOMEPAGE_TITLE "Welcome to Ash ${INFO_PRODUCTVERSION}"
!define MUI_WELCOMEPAGE_TEXT "A quiet terminal for Windows, built for CLI coding agents.$\r$\n$\r$\nSetup installs Ash with the darker Gray theme as the default for new profiles. Existing themes and settings are preserved.$\r$\n$\r$\nPlease close Ash before continuing."
!define MUI_FINISHPAGE_TEXT "Ash ${INFO_PRODUCTVERSION} is installed.$\r$\n$\r$\nOpen Ash from the Start menu or desktop shortcut. You can change the Gray theme in Settings > Appearance."

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
!insertmacro MUI_PAGE_LICENSE "..\..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page.

!insertmacro MUI_UNPAGE_INSTFILES # Uinstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

## The following two statements can be used to sign the installer and the uninstaller. The path to the binaries are provided in %1
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe" # Name of the installer's file.
!ifdef WAILS_INSTALL_SCOPE
  !if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
  !else
    # Flat: C:\Program Files\Ash  — NOT Ash\Ash (company+product nesting).
    InstallDir "$PROGRAMFILES64\${INFO_PRODUCTNAME}"
  !endif
!else
  InstallDir "$PROGRAMFILES64\${INFO_PRODUCTNAME}"
!endif # Default installing folder ($PROGRAMFILES is Program Files folder).
ShowInstDetails show # This will always show the installation details.

Function .onInit
   !insertmacro wails.checkArchitecture
FunctionEnd

# Never terminate a running terminal or remove its directory to upgrade it.
# Opening an existing executable for append checks for the Windows image lock
# without modifying its contents. Silent installs fail instead of killing Ash.
!macro EnsureAppClosed PREFIX
Function ${PREFIX}EnsureAppClosed
    IfFileExists "$INSTDIR\${PRODUCT_EXECUTABLE}" 0 done
    retry:
        ClearErrors
        FileOpen $0 "$INSTDIR\${PRODUCT_EXECUTABLE}" a
        IfErrors blocked
        FileClose $0
        Goto done
    blocked:
        IfSilent cancel
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Please close Ash before continuing. Your terminals will not be closed automatically." IDRETRY retry
    cancel:
        SetErrorLevel 2
        Abort
    done:
FunctionEnd
!macroend
!insertmacro EnsureAppClosed ""
!insertmacro EnsureAppClosed "un."

Section
    !insertmacro wails.setShellContext
    Call EnsureAppClosed

    !insertmacro wails.webview2runtime

    # Overwrite only files owned by Ash. Do not wipe the install folder or
    # touch ~/.ash: upgrades must keep user files and preferences.
    SetOutPath $INSTDIR

    !insertmacro wails.files

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols

    !insertmacro wails.writeUninstaller
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext
    Call un.EnsureAppClosed

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    Delete "$INSTDIR\${PRODUCT_EXECUTABLE}"

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"
    # Also clean any leftover lowercase shortcuts from older builds.
    Delete "$SMPROGRAMS\ash.lnk"
    Delete "$DESKTOP\ash.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
    RMDir "$INSTDIR" # Remove only when empty; unrelated files remain.
SectionEnd
