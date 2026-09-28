import type { RuntimeEvent } from "./types.js";

type Listener = (event: RuntimeEvent) => void;

export class RuntimeEventBus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(taskId: string, listener: Listener): () => void {
    const set = this.listeners.get(taskId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(taskId, set);
    return () => {
      const current = this.listeners.get(taskId);
      current?.delete(listener);
      if (current?.size === 0) this.listeners.delete(taskId);
    };
  }

  emit(event: RuntimeEvent): void {
    for (const listener of this.listeners.get(event.taskId) ?? []) listener(event);
  }
}
