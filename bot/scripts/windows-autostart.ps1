param([switch]$Remove)
$ErrorActionPreference = "Stop"

$botDir = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot "run-forever.cmd"
$launcher = Join-Path ([Environment]::GetFolderPath("Startup")) "captainblackbyte-bot.vbs"

$loops = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like "*$runner*" }
foreach ($loop in $loops) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($loop.ProcessId)"
    Stop-Process -Id $loop.ProcessId -Force
    foreach ($child in $children) {
        Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

if ($Remove) {
    Remove-Item $launcher -ErrorAction SilentlyContinue
    Write-Host "Бот остановлен, автозапуск убран."
    exit 0
}

Set-Content -Path $launcher -Encoding ASCII -Value "CreateObject(""WScript.Shell"").Run """"""$runner"""""", 0, False"
Start-Process explorer.exe -ArgumentList "`"$launcher`""

Write-Host "Бот запущен и будет стартовать при входе в Windows."
Write-Host "Журнал: $(Join-Path $botDir 'data\bot.log')"
