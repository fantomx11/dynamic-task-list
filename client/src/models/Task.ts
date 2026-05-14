import type { TaskData } from "@dynamic-task-list/shared";
import { TaskStore } from "./TaskStore";

declare function debouncedSync(): void;

function generateId(): string {
  return "temp-" + new Date().getTime().toString(16).padStart(18, "0") + "." +
    Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
}

/**
 * Represents a single todo item or a folder containing other todo items.
 */
export class Task {

  constructor(data: TaskData) {
    if (data.id === undefined) {
      data.id = generateId();
      data.isNew = true;
      this.#markDirty();
    }

    if (TaskStore.getTaskById(data.id)) {
      throw new Error(`Task with ID '${data.id}' already exists.`);
    }

    if (!data.title) {
      throw new Error("Task title is required.");
    }

    this.#data = { ...data };
  }

  //#region Private Properties

  #data: TaskData;
  #isDirty: boolean = false;

  //#endregion

  //#region Private Methods

  #markDirty(): void {
    this.#isDirty = true;
    if (typeof debouncedSync === 'function') debouncedSync();
  }

  #getDateProperty(name: keyof TaskData): Date | null {
    const value = this.#data[name];
    if (value === null || value === undefined) return null;
    const date = new Date(value as string);
    return isNaN(date.getTime()) ? null : date;
  }

  #setDateProperty(name: keyof TaskData, value: Date | string | null): void {
    if (value === null || value === "") {
      this.#setProperty(name, null);
      return;
    }
    const dateValue = value instanceof Date ? value : new Date(value);
    if (isNaN(dateValue.getTime())) {
      throw new Error("Invalid date.");
    }
    this.#setProperty(name, dateValue.toISOString());
  }

  #setProperty(name: keyof TaskData, value: any): void {
    const oldValue = this.#data[name];
    if (oldValue !== value) {
      if (Array.isArray(oldValue) && Array.isArray(value)) {
        if (oldValue.length !== value.length || !oldValue.every((val, i) => val === value[i])) {
          (this.#data as any)[name] = value;
          this.#markDirty();
          TaskStore.emitChange();
        }
      } else {
        (this.#data as any)[name] = value;
        this.#markDirty();
        TaskStore.emitChange();
      }
    }
  }

  #addChild(childTaskInstance: Task): void {
    if (this.id === childTaskInstance.id) throw new Error("A task cannot add itself as a child.");
    if (childTaskInstance.parentId === this.id) return;
    if (childTaskInstance.hasDescendent(this)) throw new Error("Circular hierarchy detected.");

    childTaskInstance.#setProperty('parentId', this.id);
  }

  #removeChild(childTaskInstance: Task): void {
    this.children.forEach(child => child.removeDependency(childTaskInstance.id));
    TaskStore.emitChange();
  }

  //#endregion

  //#region Public Properties

  get id(): string { return this.#data.id!; }
  get title(): string { return this.#data.title; }
  get sortOrder(): number { return this.#data.sortOrder || 0; }
  get type(): 'todo' | 'folder' { return this.children.length > 0 ? "folder" : "todo"; }

  get completionDate(): Date | null { return this.#getDateProperty('completion'); }
  get delay(): Date | null { return this.#getDateProperty("delay"); }

  get parent(): Task | null { return this.parentId ? TaskStore.getTaskById(this.parentId) || null : null; }
  get parentId(): string | null { return this.#data.parentId === "" ? null : (this.#data.parentId || null); }

  get children(): Task[] { return TaskStore.getChildrenForId(this.id); }
  get childrenIds(): string[] { return this.children.map(task => task.id); }
  get incompleteChildren(): Task[] { return this.children.filter(child => !child.isCompleted); }

  get dependencies(): Task[] { return this.#data.dependencyIds.map(id => TaskStore.getTaskById(id)).filter(t => t !== undefined); }
  get dependencyIds(): string[] { return [...(this.#data.dependencyIds || [])]; }

  get isDeleted(): boolean { return this.#data.isDeleted || false; }
  get isActive(): boolean { return !this.isCompleted && !this.isWaiting; }
  get isDirty(): boolean { return this.#isDirty; }

  get isCompleted(): boolean {
    if (this.type === 'todo') {
      return this.#getDateProperty("completion") !== null;
    } else {
      return this.children.length > 0 && this.children.every(child => child.isCompleted);
    }
  }

  get isWaiting(): boolean {
    const delay = this.delay;
    const dependsOnIncomplete = this.dependencies.some(dep => !dep.isCompleted);
    const ancestorIsWaiting = this.parent?.isWaiting === true;
    return (delay !== null && delay > new Date()) || dependsOnIncomplete || ancestorIsWaiting;
  }

  //#endregion

  //#region Public Methods

  hasDescendent(task: Task): boolean {
    return this.children.includes(task) || this.children.some(child => child.hasDescendent(task));
  }

  hasDependency(task: Task): boolean {
    return this.dependencies.includes(task) || this.dependencies.some(dep => dep.hasDependency(task));
  }

  complete(): void {
    if (this.type === 'folder') {
      console.warn("Folders cannot be directly completed.");
      return;
    }
    this.#setDateProperty('completion', new Date());
  }

  uncomplete(): void {
    if (this.type === 'folder') {
      console.warn("Folders cannot be directly uncompleted.");
      return;
    }
    this.#setDateProperty('completion', null);
  }

  rename(newTitle: string): void {
    if (!newTitle) {
      console.error("Task title cannot be empty.");
      return;
    }
    this.#setProperty('title', newTitle);
  }

  delayUntil(date: Date | string | null): void {
    this.#setDateProperty("delay", date);
  }

  completeOn(date: Date | string | null): void {
    this.#setDateProperty('completion', date);
  }

  addDependency(dependencyTaskId: string): void {
    const depTask = TaskStore.getTaskById(dependencyTaskId);
    if (!depTask) throw new Error(`Dependency task '${dependencyTaskId}' not found.`);
    if (depTask.id === this.id) throw new Error("A task cannot depend on itself.");
    if (this.parentId !== depTask.parentId) throw new Error('Dependency must be in the same folder.');
    if (depTask.hasDependency(this)) throw new Error("Circular dependency detected.");

    if (!(this.#data.dependencyIds || []).includes(dependencyTaskId)) {
      const newDependencies = [...(this.#data.dependencyIds || []), dependencyTaskId];
      this.#setProperty('dependencyIds', newDependencies);
    }
  }

  removeDependency(dependencyTaskId: string): void {
    const newDependencies = (this.#data.dependencyIds || []).filter(id => id !== dependencyTaskId);
    if (newDependencies.length !== (this.#data.dependencyIds || []).length) {
      this.#setProperty('dependencyIds', newDependencies);
    }
  }

  moveTo(newParent: Task | null): void {
    const oldParent = this.parent;
    if (newParent !== oldParent) {
      if (newParent) {
        newParent.#addChild(this);
      } else {
        this.#setProperty("parentId", null);
      }

      if (oldParent) {
        oldParent.#removeChild(this);
      }

      if (this.dependencyIds.length > 0) {
        this.dependencies.forEach(dep => this.removeDependency(dep.id));
      }
    }
  }

  delete(): void {
    this.children.forEach(child => child.delete());
    this.#setProperty("isDeleted", true);
  }

  toJSON(): TaskData {
    return { ...this.#data, dependencyIds: [...(this.#data.dependencyIds || [])] };
  }

  getAvailableDependencyList(): Task[] {
    return TaskStore.getChildrenForId(this.parentId).filter(task =>
      (task !== this && !task.hasDependency(this) && !task.isCompleted) ||
      (this.dependencyIds.indexOf(task.id) !== -1)
    );
  }

  sortBefore(targetTask: Task): void {
    if (!(targetTask instanceof Task)) return;
    if (targetTask.id === this.id) return;
    if (this.parentId !== targetTask.parentId) return;

    const siblings = TaskStore.getChildrenForId(this.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
    const oldIndex = siblings.findIndex(t => t.id === this.id);
    if (oldIndex === -1) return;

    siblings.splice(oldIndex, 1);
    const targetIndex = siblings.findIndex(t => t.id === targetTask.id);
    if (targetIndex === -1) return;

    siblings.splice(targetIndex, 0, this);

    let changed = false;
    siblings.forEach((taskInstance, index) => {
      if (taskInstance.#data.sortOrder !== index) {
        taskInstance.#data.sortOrder = index;
        taskInstance.#markDirty();
        changed = true;
      }
    });

    if (changed) {

    }
  }

  updateId(newId: string) {
    const oldId = this.id;
    const dependents = TaskStore.getDependents(oldId);
    const children = this.children;

    this.#data.id = newId;

    dependents.forEach(dep => {
      dep.removeDependency(oldId);
      dep.addDependency(newId);
    });

    children.forEach(child => child.#data.parentId = newId);
  }

  mergeData(data: TaskData) {
    this.#data = { ...this.#data, ...data };
  }

  duplicate(idMap = new Map<string, string>(), newParentId?: string): Task | null {
    const newId = generateId();

    idMap.set(this.id, newId);

    const originalDependencyIds = [...this.dependencyIds];

    const newData: TaskData = {
      ...this.#data,
      id: newId,
      parentId: newParentId,
      isNew: true,
      isDeleted: false,
      dependencyIds: []
    };

    const duplicatedTask = new Task(newData);

    duplicatedTask.#markDirty();

    this.children.forEach(child => {
      child.duplicate(idMap, duplicatedTask.id);
    });

    const resolvedDependencyIds = originalDependencyIds
      .map(depId => idMap.get(depId) || depId)
      .filter(id => TaskStore.getTaskById(id));

    if (JSON.stringify(duplicatedTask.dependencyIds) !== JSON.stringify(resolvedDependencyIds)) {
      duplicatedTask.#setProperty('dependencyIds', resolvedDependencyIds);
    }

    return duplicatedTask;
  }

  //#endregion

}