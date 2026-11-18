# Builds dist/tab-nap.zip with manifest.json at the zip root, as the Web Store expects.
# Uses Windows' bundled tar: Compress-Archive in Windows PowerShell writes
# backslashes in paths ("icons\icon16.png"), which the Web Store can't read.
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist "tab-nap.zip"
if (Test-Path $zip) { Remove-Item $zip }
& "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C (Join-Path $root "extension") manifest.json background.js popup.html popup.css popup.js lib icons
Write-Output "Built $zip"
