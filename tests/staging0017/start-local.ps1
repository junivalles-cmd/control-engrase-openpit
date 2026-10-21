param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$localRoot = Join-Path $taskRoot 'local'
$configPath = Join-Path $localRoot 'supabase/config.toml'
$configText = Get-Content -LiteralPath $configPath -Raw
if ($configText -notmatch '(?m)^project_id = "control_engrase_test0017"$') {
  throw 'Wrong local project identity. STOP.'
}
if (Test-Path -LiteralPath (Join-Path $localRoot 'supabase/.temp/project-ref')) {
  throw 'Remote project link detected. This starter never uses a remote link.'
}
if ($configText -notmatch '(?s)\[db\.migrations\].*?enabled = false' -or
    $configText -notmatch '(?s)\[db\.seed\].*?enabled = false') {
  throw 'Automatic migrations and seed must remain disabled.'
}
$serverVersion = & docker version --format '{{.Server.Version}}' 2>$null
if ($LASTEXITCODE -ne 0 -or -not $serverVersion) {
  throw 'Docker engine unavailable. Start/finish Docker Desktop setup manually, then retry. No SQL was run.'
}
if ($CheckOnly) { Write-Output 'Local identity and Docker checks PASS; no SQL run.'; exit 0 }
$networkName = 'TEST0017_LOOPBACK'
$network = & docker network inspect $networkName 2>$null
if ($LASTEXITCODE -ne 0) {
  & docker network create -o 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1' $networkName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated loopback network.' }
  $network = & docker network inspect $networkName
}
$networkData = ($network | ConvertFrom-Json)[0]
if ($networkData.Options.'com.docker.network.bridge.host_binding_ipv4' -ne '127.0.0.1') {
  throw 'Existing network is not bound to loopback. STOP; do not modify it automatically.'
}
$privateLog = Join-Path $localRoot 'startup.local'
& supabase start --workdir $localRoot --network-id $networkName --exclude realtime,imgproxy,studio,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta *> $privateLog
if ($LASTEXITCODE -ne 0) { throw 'Local startup failed. Inspect the private startup.local log without publishing keys.' }
Write-Output 'Local Supabase started on ports 553xx. Output containing local keys is kept in ignored startup.local.'
Write-Output 'No app schema, seed or 0017 was applied. Baseline fidelity gate is still required.'
