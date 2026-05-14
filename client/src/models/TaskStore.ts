import { Task } from './Task';
import type { TaskData, TaskSyncData } from '@dynamic-task-list/shared';

let tasks: Task[] = [];
let listeners: Array<() => void> = [];
let syncToken: number | undefined;

function updateIds(updatedIds?: Record<string, string>[]) {
  updatedIds?.forEach(({ oldId, newId }) => TaskStore.getTaskById(oldId)?.updateId(newId));
}

function mergeTasks(newTasks?: TaskData[]) {
  newTasks?.forEach(data => {
    if (!data.id) return;

    const task = TaskStore.getTaskById(data.id);

    if (task !== undefined) {
      task.mergeData(data);
    } else {
      new Task(data);
    }
  });
}

function cleanupDeletedTasks() {
  tasks = tasks.filter(task => !task.isDeleted || task.isDirty);
}

export const TaskStore = {
  emitChange() {
    listeners.forEach((listener) => listener());
  },

  subscribe(listener: () => void) {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  },

  getSnapshot() {
    return tasks;
  },

  setTasks(newTasks: Task[]) {
    tasks = newTasks;
    this.emitChange();
  },

  addTask(data: Task | TaskData) {
    if(!(data instanceof Task)) {
      data = new Task(data);
    }

    tasks = [...tasks, data];
    this.emitChange();
  },

  deleteTask(taskId: string) {
    const task = this.getTaskById(taskId);
    if (task) {
      task.delete(); // This calls #markDirty internally
      this.emitChange();
    }
  },

  getTaskById(id: string): Task | undefined {
    return tasks.find(task => task.id === id);
  },

  getChildrenForId(parentId: string | null): Task[] {
    return tasks.filter(task => task.parentId === parentId && !task.isDeleted);
  },

  getDependents(dependencyId: string) {
    return tasks.filter(task => task.dependencies.some(dep => dep.id === dependencyId));
  },

  mergeSyncResponse({ syncToken: newSyncToken, tasks, updatedIds }: TaskSyncData): void {
    updateIds(updatedIds);
    mergeTasks(tasks);
    cleanupDeletedTasks();
    syncToken = newSyncToken;
    this.emitChange();
  },

  get isDirty(): boolean {
    return tasks.some(task => task.isDirty);
  },

  get syncData(): TaskSyncData {
    const syncTasks = tasks
      .filter(task => task.isDirty)
      .map(task => task.toJSON());

    return { syncToken, tasks: syncTasks };
  },

  get allTasks(): Task[] {
    return tasks.filter(task => !task.isDeleted);
  }
};