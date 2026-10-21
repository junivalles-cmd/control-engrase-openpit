[CmdletBinding()]
param(
    [string]$JdkHome = (Join-Path $env:USERPROFILE '.jdks\jbr-17.0.14'),
    [string]$SocketDirectory
)

$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path -Parent $PSScriptRoot
$androidDirectory = Join-Path $repoDirectory 'CONTROL_ENGRASE_APP_ANDROID\android'
$javaExecutable = Join-Path $JdkHome 'bin\java.exe'
if (-not (Test-Path -LiteralPath $javaExecutable)) {
    throw 'JDK 17 no encontrado. Indica su carpeta con -JdkHome.'
}
if (-not $SocketDirectory) {
    $SocketDirectory = Join-Path $repoDirectory 'node_modules\.cache\android-java-sockets'
}
$socketDirectoryInfo = New-Item -ItemType Directory -Path $SocketDirectory -Force
$resolvedSocketDirectory = $socketDirectoryInfo.FullName
if ([Text.Encoding]::UTF8.GetByteCount($resolvedSocketDirectory) + 18 -ge 108) {
    throw 'Ruta de sockets demasiado larga. Indica una carpeta corta con -SocketDirectory.'
}

# El JDK no puede conectar sus sockets AF_UNIX bajo el TEMP de este entorno.
# La carpeta dedicada evita ese fallo; no se modifica TEMP, el JDK ni Gradle global.
# JAVA_TOOL_OPTIONS propaga el ajuste tanto al launcher como al daemon Java.
$previousJavaHome = $env:JAVA_HOME
$previousJavaToolOptions = $env:JAVA_TOOL_OPTIONS
$socketOption = '-Djdk.net.unixdomain.tmpdir="' + $resolvedSocketDirectory + '"'
try {
    $env:JAVA_HOME = $JdkHome
    $env:JAVA_TOOL_OPTIONS = (@($previousJavaToolOptions, $socketOption) | Where-Object { $_ }) -join ' '
    Push-Location $androidDirectory
    try {
        & '.\gradlew.bat' 'assembleDebug' '--stacktrace'
        if ($LASTEXITCODE -ne 0) { throw "Gradle terminó con código $LASTEXITCODE." }
        $apk = Get-Item -LiteralPath 'app\build\outputs\apk\debug\app-debug.apk'
        [pscustomobject]@{
            APK_PATH = $apk.FullName
            APK_SIZE = $apk.Length
            BUILD_TIMESTAMP_UTC = $apk.LastWriteTimeUtc.ToString('o')
        }
    } finally { Pop-Location }
} finally {
    $env:JAVA_HOME = $previousJavaHome
    $env:JAVA_TOOL_OPTIONS = $previousJavaToolOptions
}
