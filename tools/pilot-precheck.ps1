[CmdletBinding()]
param(
    [string]$Serial,
    [string]$AdbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    [string]$AppId = 'com.conequisa.engraseopenpit',
    [string]$OutDir = (Join-Path $PSScriptRoot '..\docs\pilot-precheck-captures')
)

# Pre-check de dispositivo antes de turno (seccion 1 de
# docs/PILOTO_CAMPO_CHECKLIST.md). SOLO LECTURA: nunca instala, desinstala,
# ni borra datos. Reporta hechos objetivos que adb puede verificar de
# verdad (version instalada, bateria, conectividad, arranque sin crash) y
# deja una captura de pantalla para que la persona en campo confirme a
# ojo lo subjetivo (sesion/usuario/cuadrilla/ubicacion/Mi Turno
# visualmente correcto) -- este script NUNCA inventa un "si" para eso.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File tools\pilot-precheck.ps1 -Serial <serial>
# Sin -Serial, usa el unico dispositivo conectado (falla si hay 0 o 2+).

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $AdbPath)) {
    throw "No se encontro adb en '$AdbPath'. Pasa -AdbPath si esta en otra ubicacion."
}

function Invoke-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    $allArgs = @('-s', $script:ResolvedSerial) + $Args
    & $AdbPath @allArgs
}

# Resolver dispositivo
$devicesRaw = & $AdbPath devices -l
$deviceLines = $devicesRaw | Select-String -Pattern '^\S+\s+device\b'
if (-not $Serial) {
    if ($deviceLines.Count -eq 0) { throw 'No hay dispositivos conectados (adb devices -l no muestra ninguno con estado "device"). Conecta el telefono con depuracion USB habilitada.' }
    if ($deviceLines.Count -gt 1) { throw "Hay $($deviceLines.Count) dispositivos conectados. Especifica -Serial <serial> para elegir uno." }
    $Serial = ($deviceLines[0] -split '\s+')[0]
}
$ResolvedSerial = $Serial
if (-not (& $AdbPath devices | Select-String -SimpleMatch "$Serial`tdevice")) {
    throw "El dispositivo '$Serial' no aparece como 'device' autorizado en adb."
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Write-Output "=== Pre-check de piloto — dispositivo $Serial — $stamp ==="

# --- Hechos objetivos (adb, sin interpretar) ---
$versionName = (Invoke-Adb shell dumpsys package $AppId) -join "`n" | Select-String -Pattern 'versionName=(\S+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1
$versionCode = (Invoke-Adb shell dumpsys package $AppId) -join "`n" | Select-String -Pattern 'versionCode=(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1
$battery = (Invoke-Adb shell dumpsys battery) -join "`n" | Select-String -Pattern 'level:\s*(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1
$wifiState = (Invoke-Adb shell dumpsys wifi) -join "`n" | Select-String -Pattern 'Wi-Fi is\s+(\w+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1
$dataState = (Invoke-Adb shell dumpsys telephony.registry) -join "`n" | Select-String -Pattern 'mDataConnectionState=(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1

# Lanzar la app y confirmar que no revienta en los primeros segundos.
Invoke-Adb logcat -c
Invoke-Adb shell am start -n "$AppId/.MainActivity" | Out-Null
Start-Sleep -Seconds 8
$crashLines = (Invoke-Adb logcat -d '*:E' 'AndroidRuntime:E') -join "`n" | Select-String -Pattern 'FATAL EXCEPTION|AndroidRuntime' | Select-String -Pattern $AppId
$launchOk = -not $crashLines

$screenshotRemote = "/sdcard/pilot_precheck_$stamp.png"
$screenshotLocal = Join-Path $OutDir "precheck_${Serial}_$stamp.png"
Invoke-Adb shell screencap -p $screenshotRemote | Out-Null
Invoke-Adb pull $screenshotRemote $screenshotLocal | Out-Null
Invoke-Adb shell rm $screenshotRemote | Out-Null

[pscustomobject]@{
    DEVICE          = $Serial
    APP_VERSION     = "versionName=$versionName versionCode=$versionCode"
    LAUNCH_NO_CRASH = $launchOk
    BATTERY_PCT     = $battery
    WIFI_STATE      = $wifiState
    MOBILE_DATA_STATE = $dataState
    SCREENSHOT      = $screenshotLocal
} | Format-List

Write-Output @"

=== Confirmar a ojo contra la captura de arriba (este script NO lo decide) ===
USER:          __________  (nombre visible en la pantalla coincide con el lubricador presente)
CREW:          __________  (cuadrilla mostrada coincide con la asignada)
LOCATION:      __________  (ubicacion mostrada coincide con la real)
MI_TURNO_LOAD: __________  (cargo con datos, no se quedo en "Cargando...")
SYNC_STATE:    __________  (color/texto del badge junto a la campana)
PUSH_STATE:    __________  (mandar una notificacion de prueba y confirmar que llega)
CAMERA_OK:     __________  (abrir camara desde un registro de prueba)

Completar estos 7 campos a mano en docs/PILOT_SHIFT_LOG_TEMPLATE.md junto
con los valores objetivos de arriba antes de empezar el turno.
"@
