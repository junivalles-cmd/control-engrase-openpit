// Run in the existing app WebView/DevTools. Reads only business stores:
// equipment, locations, lubrication_assignments, cuadrillas. No app_config,
// auth/session/credential reads, fetch, sync, writes, reload or data export.
// Output contains only equipment/location/assignment fields needed by audit.
(async () => {
  const inventory = await indexedDB.databases();
  if (!inventory.some(d => d.name === 'engrase_openpit')) throw new Error('Existing app database not found');
  const connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open('engrase_openpit');
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Unexpected database creation/upgrade aborted')); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Cannot read existing database'));
  });
  try {
    const stores = ['equipment', 'locations', 'lubrication_assignments', 'cuadrillas'];
    if (stores.some(s => !connection.objectStoreNames.contains(s))) throw new Error('Expected business store missing');
    const tx = connection.transaction(stores, 'readonly');
    const rows = await Promise.all(stores.map(store => new Promise((resolve, reject) => {
      const request = tx.objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Read failed: ' + store));
    })));
    const [equipment, locations, assignments, crews] = rows;
    // Uses only the existing public local read path, never changes its scope.
    const visibleLocations = typeof DB !== 'undefined' ? await DB.all('locations') : null;
    const visibleEquipment = typeof DB !== 'undefined' ? await DB.all('equipment') : null;
    const live = r => r.active !== false && r.deleted !== true;
    const state = (id, catalog) => {
      if (id == null || (typeof id === 'string' && !id.trim())) return 'MISSING';
      if (typeof id !== 'string') return 'INVALID_REFERENCE';
      const l = catalog.find(r => r.id === id);
      if (!l) return 'UNRESOLVED_LOCAL';
      if (!live(l)) return 'INACTIVE';
      if (typeof l.name !== 'string' || !l.name.trim()) return 'MISSING_NAME';
      return 'VALID';
    };
    const project = e => {
      const l = locations.find(r => r.id === e.locationId);
      const visible = visibleLocations?.find(r => r.id === e.locationId);
      return {
        id: e.id, code: e.code ?? null, locationId: e.locationId ?? null,
        resolvedLocation: l?.name ?? null, locationActive: l ? live(l) : null,
        active: e.active ?? null, effectiveActive: live(e),
        localMasterState: state(e.locationId, locations),
        visibleMasterState: visibleLocations ? state(e.locationId, visibleLocations) : null,
        uiResolvedLocation: visible && live(visible) ? visible.name ?? null : null,
        visibleInApp: visibleEquipment ? visibleEquipment.some(r => r.id === e.id) : null,
        currentAssignments: assignments.filter(a => live(a) && a.equipmentId === e.id && a.status === 'PENDING')
          .map(a => {
            const c = crews.find(r => r.id === a.assignedCrewId);
            return { id: a.id, status: a.status, planId: a.planId ?? null,
              occurrenceKey: a.occurrenceKey ?? null, assignedCrewId: a.assignedCrewId ?? null,
              crewName: c?.name ?? null, crewLocationId: c?.locationId ?? null,
              crewLocationName: locations.find(r => r.id === c?.locationId)?.name ?? null };
          }),
      };
    };
    const active = equipment.filter(live);
    const projected = active.map(project);
    return {
      readOnly: true, source: 'existing device IndexedDB; no server request', capturedAt: new Date().toISOString(),
      activeEquipmentCount: active.length, visibleEquipmentCount: visibleEquipment?.filter(live).length ?? null,
      locationCount: locations.length,
      targets: equipment.filter(e => [e.id, e.code].some(value => /^05-0870?$/.test(String(value || '').trim()))).map(project),
      affected: projected.filter(e => e.localMasterState !== 'VALID' || (e.visibleInApp && e.visibleMasterState !== 'VALID')),
      limitation: 'Missing in this local catalog does not prove missing in Supabase. Crew location is contextual only; never substituted for equipment.locationId.',
    };
  } finally { connection.close(); }
})();
