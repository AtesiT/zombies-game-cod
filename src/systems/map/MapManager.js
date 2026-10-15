import { EventBus } from '../../utils/EventBus.js';
import { validateRegistry } from './MapSchema.js';
/** Registry and selection state; gameplay sessions remain owned by Game. */
export class MapManager extends EventBus {
  maps = [];
  current = null;
  status = 'idle';
  error = '';
  #request = 0;
  /** Fetch and validate atomically. Newer requests supersede older responses. */
  async load(url = 'assets/maps/registry.json', fetcher = globalThis.fetch) {
    const request = ++this.#request;
    this.status = 'loading'; this.error = ''; this.emit('status', this.status);
    try {
      const response = await fetcher(url);
      if (!response.ok) throw new Error(`Map registry HTTP ${response.status}`);
      const data = validateRegistry(await response.json());
      if (request !== this.#request) return false;
      this.maps = data.maps;
      this.status = 'ready'; this.emit('ready', this.maps); return true;
    } catch (error) {
      if (request !== this.#request) return false;
      this.status = 'error'; this.error = error.message; this.emit('error', this.error); return false;
    }
  }
  /** Read a registered definition; unknown IDs never fall back silently. */
  get(id) { const map = this.maps.find(m => m.id === id); if (!map) throw new Error(`Unknown map: ${id}`); return map; }
  /** Commit selection after the consumer successfully constructs its level. */
  select(id) { this.current = id === null ? null : this.get(id); this.emit('map:loaded', this.current); return this.current; }
  /** Cancel pending loads and release subscribers. */
  dispose() { ++this.#request; super.dispose(); }
}
