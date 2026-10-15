/** Bounded reusable storage. Callers reset every acquired record. */
export class ObjectPool {
  constructor(factory, reset = () => {}, capacity = 256) {
    this.factory = factory;
    this.reset = reset;
    this.capacity = capacity;
    this.free = [];
  }
  /** Obtain an initialized record. */
  acquire(...args) {
    const value = this.free.pop() ?? this.factory();
    this.reset(value, ...args);
    return value;
  }
  /** Return a record owned by the caller. */
  release(value) {
    if (this.free.length < this.capacity) this.free.push(value);
  }
  /** Release retained objects. */
  clear() {
    this.free.length = 0;
  }
}
