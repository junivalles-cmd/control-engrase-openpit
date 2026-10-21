param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-z]{20}$')][string]$ProjectRef,
 [ValidateSet('inspect','baseline','compare','seed','apply0017','equivalence','security','performance','rollback','reapply','cleanup')][string]$Action='inspect',
 [switch]$Execute
)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location -LiteralPath $repoRoot
if ($ProjectRef -in @('havrirlapjyqrffgalqx','nxbwdrfgezzrfqzxgaks')) { throw 'Known production/other app denied.' }
$projectsJson=& supabase projects list --output json 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify project identity using the existing CLI session.' }
$projects=$projectsJson | ConvertFrom-Json
$target=@($projects | Where-Object { $_.ref -eq $ProjectRef -or $_.id -eq $ProjectRef })
if ($target.Count -ne 1 -or $target[0].name -ne 'control_engrase_staging_0017' -or $target[0].status -ne 'ACTIVE_HEALTHY') {
 throw 'Expected one ACTIVE_HEALTHY control_engrase_staging_0017. STOP.'
}
$writeActions=@('baseline','seed','apply0017','security','performance','rollback','reapply','cleanup')
if ($Action -in $writeActions -and -not $Execute) { throw 'Prepared only: explicit -Execute required for a staging write/test transaction.' }
$workdir=Join-Path $PSScriptRoot 'remote'
New-Item -ItemType Directory -Path $workdir -Force | Out-Null
function Invoke-StageSql([string]$SqlFile,[string]$OutputFile='tests/staging0017/remote-last-result.local.json') {
 # Explicit ref + separate workdir. Never supabase link or a root linked ref.
 $result=& supabase db query --linked --project-ref $ProjectRef --workdir $workdir --file $SqlFile --output json 2>$null
 $queryExit=$LASTEXITCODE
 $result | Set-Content -LiteralPath $OutputFile -Encoding utf8
 if ($queryExit -ne 0) { throw "Stage SQL failed ($Action). Private result: $OutputFile" }
}
function Require-ComparedBaseline {
 $path='docs/evidence/0017_REMOTE_SCHEMA_COMPARISON.json'
 if (-not (Test-Path -LiteralPath $path)) { throw 'Remote schema comparison absent.' }
 $check=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
 if ($check.projectRef -ne $ProjectRef -or -not $check.remoteStagingCompared -or $check.schemaEquivalent -ne 'PASS_CRITICAL_SCOPE') { throw 'Remote baseline comparison must PASS for this exact ref.' }
}
if ($Action -eq 'inspect') {
 $probe=Join-Path $PSScriptRoot 'remote-target-probe.local.sql'
 @'
begin transaction read only;
select current_setting('transaction_read_only') as read_only,
 to_regclass('public.engrase_sync') is null as empty_application,
 to_regclass('auth.users') is not null as managed_auth,
 to_regclass('storage.objects') is not null as managed_storage;
rollback;
'@ | Set-Content -LiteralPath $probe -Encoding utf8
 Invoke-StageSql $probe
 Write-Output 'Staging identity verified; read-only probe saved privately. No schema applied.'
 exit 0
}
if ($Action -eq 'baseline') {
 # target-marker.sql is additionally guarded with emptiness checks before
 # any marker or application object can be written.
 $marker=Join-Path $PSScriptRoot 'remote-marker.local.sql'
 $markerSource=Get-Content tests/staging0017/target-marker.sql -Raw
 $emptyGuard=@'
do $empty_target$ begin
 if to_regclass('public.engrase_sync') is not null or to_regclass('public.app_profiles') is not null
   or to_regnamespace('authorization_private') is not null then raise exception 'Application schema is not empty'; end if;
end $empty_target$;
'@
 $markerSource.Replace('begin;',"begin;`n$emptyGuard") | Set-Content -LiteralPath $marker -Encoding utf8
 Invoke-StageSql $marker
 Invoke-StageSql 'supabase/staging/0017_PRODUCTION_BASELINE_SCHEMA_PREPARED.sql'
 Write-Output 'Baseline loaded in identified staging. Run -Action compare before any 0017 application.'
 exit 0
}
if ($Action -eq 'compare') {
 Invoke-StageSql 'tests/staging0017/capture-baseline-catalog.sql' 'tests/staging0017/remote-baseline-catalog.local.json'
 Invoke-StageSql 'tests/staging0017/capture-function-fingerprints.sql' 'tests/staging0017/remote-function-fingerprints.local.json'
 & node tests/staging0017/compare-remote-baseline.mjs $ProjectRef
 if ($LASTEXITCODE -ne 0) { throw 'Schema comparison failed. Do not apply 0017.' }
 exit 0
}
if ($Action -in @('seed','apply0017')) { Require-ComparedBaseline }
if ($Action -eq 'apply0017') {
 $baselineEvidence='docs/evidence/0017_REMOTE_BASELINE_TESTS.json'
 if (-not (Test-Path -LiteralPath $baselineEvidence)) { throw 'Actual remote baseline tests are required; a schema match alone is insufficient.' }
 $tested=Get-Content -LiteralPath $baselineEvidence -Raw | ConvertFrom-Json
 if ($tested.projectRef -ne $ProjectRef -or $tested.baseline0016 -ne 'PASS' -or
     $tested.normalSync -ne 'PASS' -or $tested.unknownStore -ne 'PASS' -or $tested.existingStoreAuthorization -ne 'PASS') { throw 'Baseline test evidence must PASS for this exact staging ref.' }
}
$scripts=@{
 seed='tests/staging0017/seed.synthetic.sql'
 apply0017='CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0017_broadcast_messages_scope_PREPARED.sql'
 equivalence='docs/0017_BROADCAST_MESSAGES_EQUIVALENCE_TESTS_READ_ONLY.sql'
 security='tests/staging0017/security.staging.sql'
 performance='tests/staging0017/performance.sql'
 rollback='CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0017_broadcast_messages_scope_ROLLBACK_PREPARED.sql'
 reapply='CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0017_broadcast_messages_scope_PREPARED.sql'
 cleanup='tests/staging0017/cleanup.synthetic.sql'
}
if ($Action -eq 'reapply') {
 try { Invoke-StageSql $scripts[$Action] } catch {
  Write-Output 'Reapply was rejected. Review private error for the expected retained-helper precondition; rejection alone is not an automatic PASS.'
  throw
 }
} else { Invoke-StageSql $scripts[$Action] }
Write-Output "Staging action completed: $Action. Review evidence before the next step."
