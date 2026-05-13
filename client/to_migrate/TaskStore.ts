// TaskStore.ts
import { Task, TaskData } from './Task';

let tasks: Task[] = [];
let listeners: Array<() => void> = [];

export const TaskStore = {
  // Instead of static events, we call this after mutations
  emitChange() {
    listeners.forEach(l => l());
  },

  subscribe(listener: () => void) {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  },

  getSnapshot() {
    return tasks;
  },

  addTask(data: TaskData) {
    const newTask = new Task(data);
    tasks = [...tasks, newTask]; // Immutability helps React
    this.emitChange();
  }
};