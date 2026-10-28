[CmdletBinding()]
param(
    [string]$JdkHome = (Join-Path $env:USERPROFILE '.jdks\jbr-17.0.14'),
    [string]$SocketDirectory,
    [ValidateSet('debug', 'release', 'bundle')]
    [string]$Variant = 'debug'
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
        $gradleTask = switch ($Variant) {
            'debug' { 'assembleDebug' }
            'release' { 'assembleRelease' }
            'bundle' { 'bundleRelease' }
        }
        & '.\gradlew.bat' $gradleTask '--stacktrace'
        if ($LASTEXITCODE -ne 0) { throw "Gradle terminó con código $LASTEXITCODE." }
        $artifactPath = switch ($Variant) {
            'debug' { 'app\build\outputs\apk\debug\app-debug.apk' }
            'release' { 'app\build\outputs\apk\release\app-release.apk' }
            'bundle' { 'app\build\outputs\bundle\release\app-release.aab' }
        }
        $artifact = Get-Item -LiteralPath $artifactPath
        [pscustomobject]@{
            VARIANT = $Variant
            ARTIFACT_PATH = $artifact.FullName
            ARTIFACT_SIZE = $artifact.Length
            SHA256 = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash
            BUILD_TIMESTAMP_UTC = $artifact.LastWriteTimeUtc.ToString('o')
        }
    } finally { Pop-Location }
} finally {
    $env:JAVA_HOME = $previousJavaHome
    $env:JAVA_TOOL_OPTIONS = $previousJavaToolOptions
}
