import type { AgentAction, TaskRecord } from "./types.js";

export class InMemoryTaskStore {
  private tasks = new Map<string, TaskRecord>();
  private approvals = new Map<string, (approved: boolean) => void>();

  create(task: TaskRecord): TaskRecord {
    this.tasks.set(task.id, structuredClone(task));
    return this.get(task.id)!;
  }

  get(id: string): TaskRecord | undefined {
    const value = this.tasks.get(id);
    return value ? structuredClone(value) : undefined;
  }

  update(id: string, mutator: (task: TaskRecord) => void): TaskRecord {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    mutator(task);
    task.updatedAt = new Date().toISOString();
    return structuredClone(task);
  }

  waitForApproval(taskId: string, action: AgentAction, reason: string): Promise<boolean> {
    this.update(taskId, task => {
      task.status = "waiting_for_approval";
      task.approval = { action, reason };
    });
    return new Promise(resolve => this.approvals.set(taskId, resolve));
  }

  resolveApproval(taskId: string, approved: boolean): void {
    const resolve = this.approvals.get(taskId);
    if (!resolve) throw new Error(`Task ${taskId} is not waiting for approval`);
    this.approvals.delete(taskId);
    this.update(taskId, task => {
      task.approval = undefined;
      task.status = approved ? "running" : "cancelled";
    });
    resolve(approved);
  }
}
