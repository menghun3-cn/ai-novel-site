# Novel Web Publisher deployment zip packer
#
# Usage:
#   npm run pack:deploy                          # -> ..\novel-web-publisher.zip
#   npm run pack:deploy -- -Name foo.zip         # custom file name
#   npm run pack:deploy -- -Name D:\path\x.zip   # custom output path
#
# Excludes: node_modules / web\.next / .git / logs / data / *.tsbuildinfo / *.zip
#           rebuild.sh (server already owns it; zip would reset its exec bit)
#           data/      (never overwrite server DB on upgrade; import novels on fresh deploy)
# Keeps:    novels/ web/public/covers (compose volume mounts) + deploy files

param(
  [string]$Name = 'novel-web-publisher.zip'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

# guard: require PowerShell 7+ (5.1 breaks CJK encoding and writes backslash zip entry names)
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw ("this script requires PowerShell 7+ (pwsh). Current: " + $PSVersionTable.PSVersion.ToString() +
         "  ->  run: npm run pack:deploy  (it invokes pwsh), or install https://aka.ms/powershell")
}
Write-Host ("[pack:deploy] PowerShell " + $PSVersionTable.PSVersion.ToString())

# project root = parent of scripts/
$Root = Split-Path -Parent $PSScriptRoot

# bare file name -> put next to project; path -> use as-is
if ($Name -match '[\\/]') { $Dest = $Name } else { $Dest = Join-Path (Split-Path -Parent $Root) $Name }

$Stage = Join-Path $env:TEMP ('nwp-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

try {
  # 1. stage via robocopy (excludes deps / build output / vcs / logs)
  robocopy $Root $Stage /E /XD node_modules .next .git logs data /XF '*.tsbuildinfo' '*.zip' 'rebuild.sh' /NFL /NDL /NJH | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "robocopy failed with exit code $LASTEXITCODE" }

  # 2. pack via .NET ZipFile (UTF-8 entry names, CJK-safe)
  if (Test-Path $Dest) { Remove-Item $Dest -Force }
  [IO.Compression.ZipFile]::CreateFromDirectory($Stage, $Dest, [IO.Compression.CompressionLevel]::Optimal, $false)

  # 3. self-verify (missing/leak -> non-zero exit)
  $zip = [IO.Compression.ZipFile]::OpenRead($Dest)
  try {
    $names = $zip.Entries.FullName
    $required = @(
      'Dockerfile', 'docker-compose.yml', '.dockerignore',
      'package.json', 'package-lock.json', 'tsconfig.json',
      'web/package.json', 'web/lib/markdown.ts', 'core/src/index.ts', 'importer/src/index.ts'
    )
    $missing = @()
    foreach ($k in $required) {
      if ($names -notcontains $k) { $missing += $k }
    }
    foreach ($dir in @('novels/')) {
      if (-not ($names | Where-Object { $_.StartsWith($dir) })) { $missing += $dir }
    }
    # data/ must NOT ship (upgrade must never clobber server DB)
    $dataLeak = ($names | Where-Object { $_.StartsWith('data/') }).Count
    if ($dataLeak -gt 0) { throw ("data/ leaked into zip: " + $dataLeak + " entries") }
    $leaks = ($names | Where-Object { $_ -match 'node_modules|\.next/|^\.git/' }).Count
    if ($missing.Count -gt 0) { throw ("missing in zip: " + ($missing -join ', ')) }
    if ($leaks -gt 0) { throw ("leaked node_modules/.next/.git entries: " + $leaks) }
    Write-Host ('[pack:deploy] OK  {0}  ({1:N1} MB, {2} files)' -f $Dest, ((Get-Item $Dest).Length / 1MB), $names.Count)
  } finally {
    $zip.Dispose()
  }
} finally {
  if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue }
}
