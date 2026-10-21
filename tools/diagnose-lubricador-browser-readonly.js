// Paste the COMPLETE file into DevTools Console of the affected Web tab.
// Read-only: no fetch, sync calls, storage writes, token reads, logout or reload.
// Outputs aggregate counts/booleans only; no identities, payloads or secrets.
(async () => {
  const dbName = 'engrase_openpit';
  if (typeof indexedDB.databases !== 'function') throw new Error('Database inventory unavailable; stopped without opening/creating a DB');
  const inventory = await indexedDB.databases();
  if (!inventory.some(d => d.name === dbName)) throw new Error('Existing app database not found on this origin');
  const connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Unexpected database creation/upgrade aborted')); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Cannot open existing app database'));
  });
  const read = (store, key) => new Promise((resolve, reject) => {
    if (!connection.objectStoreNames.contains(store)) { resolve(key === undefined ? [] : null); return; }
    const tx = connection.transaction(store, 'readonly');
    const request = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Read failed for ' + store));
  });
  try {
    const snapshot = (await read('app_config', 'auth_profile_snapshot'))?.value;
    const profile = typeof Auth !== 'undefined' && Auth.getProfile ? Auth.getProfile() : snapshot;
    if (!profile?.appUserId) throw new Error('No current app profile available; stopped without reading credentials');
    const context = (await read('app_config', 'authorization_context:' + profile.appUserId))?.value;
    const cfg = (await read('app_config', 'sync'))?.value;
    const accountKey = context?.authUserId && context?.authorizationFingerprint
      ? encodeURIComponent(context.authUserId)+':'+encodeURIComponent(context.authorizationFingerprint) : null;
    const accountState = accountKey ? cfg?.accountSyncStates?.[accountKey] : null;
    const crewIds = new Set(context?.authorizedCrewIds || []);
    const locationIds = new Set(context?.authorizedLocationIds || []);
    const stores = ['cuadrillas','locations','equipment','lubrication_plans','lubrication_points','settings','shifts'];
    const raw = {};
    for (const store of stores) raw[store] = await read(store);
    const counts = [];
    for (const store of stores) {
      const rows = raw[store];
      const appVisible = typeof DB !== 'undefined' && DB.all ? await DB.all(store) : null;
      counts.push({
        store, raw: rows.length,
        active: rows.filter(r => r.active !== false).length,
        ownedByCurrent: rows.filter(r => r.__authorizationAppUserId === profile.appUserId).length,
        ownedByOther: rows.filter(r => r.__authorizationAppUserId && r.__authorizationAppUserId !== profile.appUserId).length,
        untagged: rows.filter(r => !r.__authorizationAppUserId).length,
        dirty: rows.filter(r => r._pushedVersion !== r.updatedAt).length,
        visibleByApp: appVisible ? appVisible.length : null,
        activeVisibleByApp: appVisible ? appVisible.filter(r => r.active !== false).length : null
      });
    }
    const activeCrews = raw.cuadrillas.filter(r => r.active !== false);
    const matches = activeCrews.filter(r => crewIds.has(r.id));
    let selection = null;
    try { selection = JSON.parse(localStorage.getItem('engrase_session_crew') || 'null'); } catch { /* count only */ }
    const scope = typeof getCurrentOperationalScope === 'function' ? await getCurrentOperationalScope() : null;
    const pulls = performance.getEntriesByType('resource')
      .filter(e => { try { return new URL(e.name).pathname.endsWith('/rest/v1/engrase_sync'); } catch { return false; } });
    const lastPullRequest = pulls.at(-1);
    const requestCursor = lastPullRequest ? new URL(lastPullRequest.name).searchParams.get('updated_at') : null;
    const result = {
      readOnly: true, role: profile.role,
      contextPresent: !!context, scopeType: context?.scopeType || null,
      rowScopeEnforced: context?.rowScopeEnforced === true,
      authorizedCrews: crewIds.size, authorizedLocations: locationIds.size,
      contextMatchesProfile: context?.appUserId === profile.appUserId,
      fingerprintMatchesMemory: !!context?.authorizationFingerprint && profile.authorizationFingerprint === context.authorizationFingerprint,
      appUserMatchesProfile: typeof App !== 'undefined' ? App.currentUser?.id === profile.appUserId : null,
      legacyLastPull: cfg?.lastPull || null,
      accountLastPull: accountState?.lastPull || null,
      accountBootstrapComplete: accountState?.bootstrapComplete===true && cfg?.activeAccountSyncKey===accountKey,
      lastObservedRequestCursor: requestCursor,
      syncStatus: typeof lastSyncState !== 'undefined' ? lastSyncState.status : null,
      syncPulled: typeof lastSyncState !== 'undefined' ? lastSyncState.pulled ?? null : null,
      activeCrewsMatchingServerIds: matches.length,
      matchingCrewsOwnedByCurrent: matches.filter(r => r.__authorizationAppUserId === profile.appUserId).length,
      matchingCrewsWithMembership: matches.filter(r => Array.isArray(r.memberUserIds) && r.memberUserIds.includes(profile.appUserId)).length,
      selectedCrewBelongsToCurrent: selection?.userId === profile.appUserId,
      selectedCrewAuthorized: selection?.userId === profile.appUserId && crewIds.has(selection?.crewId),
      operationalScopeKind: scope?.kind || null,
      recognizedCrewCount: scope?.authorizedCrews?.length ?? null,
      stores: counts,
      limitation: 'Counts describe local state, not past response bodies. Resource timing may be absent; null app fields mean bundle globals are unavailable.'
    };
    console.log('[ENGRASE_READONLY_DIAGNOSTIC]', JSON.stringify(result, null, 2));
    return result;
  } finally { connection.close(); }
})().catch(() => { console.error('[ENGRASE_READONLY_DIAGNOSTIC] Cannot read local state; no data or credentials were changed.'); });
