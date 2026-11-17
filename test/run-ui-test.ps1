$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  Write-Host 'Building HTML...'
  & node build.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host 'Generating fixtures...'
  & node test/make-fixtures.cjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host 'Generating UI test page...'
  & node test/make-test-page.cjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $chrome = $env:CHROME_PATH
  if (-not $chrome -or -not (Test-Path $chrome)) {
    $cmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($cmd) { $chrome = $cmd.Source }
  }
  if (-not $chrome -or -not (Test-Path $chrome)) {
    $found = Get-ChildItem "$env:LOCALAPPDATA\ms-playwright" -Filter chrome.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $chrome = $found.FullName }
  }
  if (-not $chrome -or -not (Test-Path $chrome)) {
    $candidates = @(
      'C:\Program Files\Google\Chrome\Application\chrome.exe',
      'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
      'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
      'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    )
    foreach ($c in $candidates) { if (Test-Path $c) { $chrome = $c; break } }
  }
  if (-not $chrome -or -not (Test-Path $chrome)) {
    Write-Error 'Chrome/Chromium/Edge not found. Set CHROME_PATH to run the UI test.'
  }

  $page = Join-Path $root 'demo-test.html'
  $uri = ([System.Uri]$page).AbsoluteUri
  $dump = Join-Path $root 'test\ui-result.html'
  if (Test-Path $dump) { Remove-Item $dump -Force }

  Write-Host ('Running headless browser: ' + $chrome)
  & $chrome --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files --window-size=1500,1000 --virtual-time-budget=20000 --dump-dom $uri 2>$null | Out-File -FilePath $dump -Encoding utf8

  & node test/extract-ui-result.cjs $dump
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
