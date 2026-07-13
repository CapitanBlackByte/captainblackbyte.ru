#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "==> Сборка сайта"
npm run build

Write-Host "==> Правила брандмауэра Windows (80, 443)"
$rules = @(
    @{ Name = "Captain Black Byte HTTP"; Port = 80 },
    @{ Name = "Captain Black Byte HTTPS"; Port = 443 }
)

foreach ($rule in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
    if (-not $existing) {
        New-NetFirewallRule `
            -DisplayName $rule.Name `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalPort $rule.Port | Out-Null
        Write-Host "Добавлено: $($rule.Name)"
    } else {
        Write-Host "Уже есть: $($rule.Name)"
    }
}

Write-Host ""
Write-Host "========================================"
Write-Host "  Капитан Чёрный Байт — captainblackbyte.ru"
Write-Host "========================================"
Write-Host ""
Write-Host "1. DNS у регистратора (обязательно):"
Write-Host "   A   @    -> 46.138.27.146"
Write-Host "   A   www  -> 46.138.27.146"
Write-Host ""
Write-Host "2. Роутер (проброс портов на этот ПК):"
Write-Host "   TCP 80  -> 192.168.1.73"
Write-Host "   TCP 443 -> 192.168.1.73"
Write-Host ""
Write-Host "3. Подождите 5-30 минут, пока DNS обновится"
Write-Host "   Проверка: nslookup captainblackbyte.ru"
Write-Host ""
Write-Host "4. Запуск production-сервера (от администратора):"
Write-Host "   npm run production"
Write-Host ""
Write-Host "Сайт откроется на:"
Write-Host "   https://captainblackbyte.ru"
Write-Host ""
