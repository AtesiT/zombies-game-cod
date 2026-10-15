/** Small synchronous event hub with explicit subscription ownership. */
export class EventBus {
  #listeners = new Map();
  /** Subscribe; returns an unsubscribe function. */
  on(type, listener) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type).add(listener);
    return () => this.#listeners.get(type)?.delete(listener);
  }
  /** Publish a payload to current subscribers. */
  emit(type, data) { for (const fn of [...(this.#listeners.get(type) ?? [])]) fn(data); }
  /** Release all subscriptions. */
  dispose() { this.#listeners.clear(); }
}
