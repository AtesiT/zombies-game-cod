/** Canvas menu adapter: inherits existing keyboard, pointer and touch navigation. */
export function mapSelectionRows(manager) {
  const rows = manager.maps.map(m => ({ id: `map:${m.id}`, label: m.name.toUpperCase(), hint: m.description }));
  if (manager.status === 'loading' || manager.status === 'idle') rows.push({ id: 'none', label: 'LOADING MAPS…' });
  if (manager.status === 'error') rows.push({ id: 'retryMaps', label: 'RETRY LOADING MAPS', hint: manager.error });
  rows.push({ id: 'classic', label: 'NACHT DER UNTOTEN', hint: 'original three-storey campaign' });
  rows.push({ id: 'back', label: 'BACK' });
  return rows;
}
