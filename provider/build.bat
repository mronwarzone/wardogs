@echo off
setlocal
set "ROOT=%~dp0"
set "OUT=%ROOT%build"
if not exist "%OUT%" mkdir "%OUT%"

where cl >nul 2>&1
if errorlevel 1 (
  echo Run this from an x64 Native Tools VS prompt, or call VsDevCmd first.
  exit /b 1
)

pushd "%OUT%"
cl /nologo /std:c++20 /O2 /EHsc /DNOMINMAX /DUNICODE /D_UNICODE ^
  /I "%ROOT%include" ^
  "%ROOT%main.cpp" ^
  "%ROOT%discovery.cpp" ^
  "%ROOT%ingest.cpp" ^
  "%ROOT%backends\win32_rpm.cpp" ^
  /Fe:wardogs-provider.exe ^
  user32.lib winhttp.lib
set ERR=%ERRORLEVEL%
popd
if not "%ERR%"=="0" exit /b %ERR%
echo Built %OUT%\wardogs-provider.exe
echo 1^) start the map   2^) run wardogs-provider.exe
exit /b 0
