!define PDF_THUMBNAIL_CLSID "{3E4A0E76-C94E-4BC2-A21C-85B478094371}"
!define PDF_THUMBNAIL_HANDLER "Software\Classes\SolutionsPDF.Pdf\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}"
!define PDF_THUMBNAIL_BACKUP "Software\Classes\SolutionsPDF.Pdf\PdfThumbnailProvider"
!define PDF_THUMBNAIL_APPLICATION_HANDLER "Software\Classes\Applications\solutionpdf.exe\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}"
!define PDF_THUMBNAIL_APPLICATION_BACKUP "Software\Classes\Applications\solutionpdf.exe\PdfThumbnailProvider"
!define PDF_THUMBNAIL_CLASS "Software\Classes\CLSID\${PDF_THUMBNAIL_CLSID}"
!define LEGACY_PDF_THUMBNAIL_HANDLER "Software\Classes\.pdf\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}"
!define LEGACY_PDF_THUMBNAIL_BACKUP "Software\Classes\SolutionsPDF.PdfThumbnailProvider"

!macro NSIS_HOOK_POSTINSTALL
  SetRegView 64
  SetOutPath "$INSTDIR"

  ReadRegStr $2 HKCU "${LEGACY_PDF_THUMBNAIL_HANDLER}" ""
  ${If} $2 == "${PDF_THUMBNAIL_CLSID}"
    ReadRegStr $3 HKCU "${LEGACY_PDF_THUMBNAIL_BACKUP}" "PreviousHandler"
    ${If} $3 == ""
      DeleteRegValue HKCU "${LEGACY_PDF_THUMBNAIL_HANDLER}" ""
      DeleteRegKey /ifempty HKCU "Software\Classes\.pdf\ShellEx"
    ${Else}
      WriteRegStr HKCU "${LEGACY_PDF_THUMBNAIL_HANDLER}" "" "$3"
    ${EndIf}
    DeleteRegKey HKCU "${LEGACY_PDF_THUMBNAIL_BACKUP}"
  ${EndIf}

  ReadRegStr $0 HKCU "${PDF_THUMBNAIL_HANDLER}" ""
  ReadRegStr $1 HKCU "${PDF_THUMBNAIL_BACKUP}" "PreviousHandler"
  ${If} $1 == ""
  ${AndIf} $0 != "${PDF_THUMBNAIL_CLSID}"
    WriteRegStr HKCU "${PDF_THUMBNAIL_BACKUP}" "PreviousHandler" "$0"
  ${EndIf}

  ReadRegStr $0 HKCU "${PDF_THUMBNAIL_APPLICATION_HANDLER}" ""
  ReadRegStr $1 HKCU "${PDF_THUMBNAIL_APPLICATION_BACKUP}" "PreviousHandler"
  ${If} $1 == ""
  ${AndIf} $0 != "${PDF_THUMBNAIL_CLSID}"
    WriteRegStr HKCU "${PDF_THUMBNAIL_APPLICATION_BACKUP}" "PreviousHandler" "$0"
  ${EndIf}

  WriteRegStr HKCU "${PDF_THUMBNAIL_CLASS}" "" "SolutionsPDF PDF Thumbnail Provider"
  WriteRegStr HKCU "${PDF_THUMBNAIL_CLASS}\InprocServer32" "" "$INSTDIR\solutionpdf_thumbnailer.dll"
  WriteRegStr HKCU "${PDF_THUMBNAIL_CLASS}\InprocServer32" "ThreadingModel" "Apartment"
  WriteRegStr HKCU "${PDF_THUMBNAIL_HANDLER}" "" "${PDF_THUMBNAIL_CLSID}"
  WriteRegStr HKCU "${PDF_THUMBNAIL_APPLICATION_HANDLER}" "" "${PDF_THUMBNAIL_CLSID}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  SetRegView 64
  ReadRegStr $0 HKCU "${PDF_THUMBNAIL_HANDLER}" ""
  ${If} $0 == "${PDF_THUMBNAIL_CLSID}"
    ReadRegStr $1 HKCU "${PDF_THUMBNAIL_BACKUP}" "PreviousHandler"
    ${If} $1 == ""
      DeleteRegValue HKCU "${PDF_THUMBNAIL_HANDLER}" ""
    ${Else}
      WriteRegStr HKCU "${PDF_THUMBNAIL_HANDLER}" "" "$1"
    ${EndIf}
  ${EndIf}

  ReadRegStr $0 HKCU "${PDF_THUMBNAIL_APPLICATION_HANDLER}" ""
  ${If} $0 == "${PDF_THUMBNAIL_CLSID}"
    ReadRegStr $1 HKCU "${PDF_THUMBNAIL_APPLICATION_BACKUP}" "PreviousHandler"
    ${If} $1 == ""
      DeleteRegValue HKCU "${PDF_THUMBNAIL_APPLICATION_HANDLER}" ""
      DeleteRegKey /ifempty HKCU "Software\Classes\Applications\solutionpdf.exe\ShellEx"
    ${Else}
      WriteRegStr HKCU "${PDF_THUMBNAIL_APPLICATION_HANDLER}" "" "$1"
    ${EndIf}
  ${EndIf}

  DeleteRegKey HKCU "${PDF_THUMBNAIL_CLASS}"
  DeleteRegKey HKCU "${PDF_THUMBNAIL_BACKUP}"
  DeleteRegKey HKCU "${PDF_THUMBNAIL_APPLICATION_BACKUP}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend