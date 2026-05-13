/**
 * Interface representing the raw data of a Task.
 */
export interface TaskData {
  id?: string;
  title: string;
  isCompleted?: boolean;
  parentId?: string | null;
  dependencyIds?: string[];
  delay?: string | null;
  deleted?: boolean;
  isNew?: boolean;
  sortOrder?: number;
  completionDate?: string | null;
}

/**
 * Generic interface for synchronization payloads.
 */
export interface SyncTypePayload<T> {
  syncToken: number | null;
  updates: T[];
}

/**
 * Maps temporary client IDs to permanent server IDs.
 */
export interface IdMapping {
  oldId: string;
  newId: string;
}

/**
 * Generic interface for synchronization responses.
 */
export interface SyncTypeResponse<T> {
  syncToken: number | null;
  updates: T[];
  updatedIds: IdMapping[];
}

/**
 * Details for global task events.
 */
export interface TaskEventDetail {
  type: string;
  task?: Task;
  addedTasks?: Task[];
  updatedTasks?: Task[];
  removedTasks?: Task[];
  taskId?: string;
  name?: string;
  oldValue?: any;
  newValue?: any;
}

// Placeholder for the debouncedSync function referenced in the original code
declare function debouncedSync(): void;

/**
 * Represents a single todo item or a folder containing other todo items.
 */
export class Task {
  //#region static private fields

  static #tasks = new Map<string, Task>();
  static #syncToken: number | null = null;

  //#endregion

  //#region Static Properties

  /** Whether any task in the global collection is marked as dirty. */
  static get isDirty(): boolean {
    return [...this.#tasks.values()].some(task => task.#isDirty);
  }

  /** Gets the data prepared for synchronization. */
  static get syncData(): SyncTypePayload<TaskData> {
    const syncToken = this.#syncToken;
    const updates = [...this.#tasks.values()]
      .filter(task => task.#isDirty)
      .map(task => task.toJSON());

    return { syncToken, updates };
  }

  /** Returns all non-deleted tasks. */
  static get allTasks(): Task[] {
    return [...this.#tasks.values()].filter(task => !task.#data.deleted);
  }

  //#endregion

  //#region Static Methods

  /** Generates a unique temporary ID for new tasks. */
  static generateId(): string {
    return "temp-" + new Date().getTime().toString(16).padStart(18, "0") + "." +
      Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  }

  /** Retrieves a Task instance by its ID. */
  static getTaskById(id: string): Task | undefined {
    return Task.#tasks.get(id);
  }

  /** Retrieves all direct child Task instances for a given parent. */
  static getChildrenForId(parentId: string | null): Task[] {
    return [...this.#tasks.values()].filter(task => task.parentId === parentId && !task.#data.deleted);
  }

  /** Merges synchronization response data into the client collection. */
  static mergeSyncResponse({ syncToken, updates, updatedIds }: SyncTypeResponse<TaskData>): void {
    const addedTasks: Task[] = [];
    const updatedTasks: Task[] = [];
    const removedTasks: Task[] = [];

    //Step 1: update the oldId to the new Id before doing anything else. The project will also be included
    //in updates using the newId, so as long as the id matches, it will get updated when updates are processed
    updatedIds?.forEach(({ oldId, newId }) => {
      const task = this.#tasks.get(oldId);
      if (task) {
        this.#tasks.delete(oldId);
        this.#tasks.set(newId, task);
        task.#data.id = newId;
      }
    });

    // Phase 2: Process Updates/Additions
    updates?.forEach(data => {
      if (!data.id) return;
      const task = this.getTaskById(data.id);

      if (task !== undefined) {
        task.#data = { ...data };
        task.#isDirty = false;
        task.#dispatchChange();
        updatedTasks.push(task);
      } else {
        const newTaskInstance = new Task(data);
        addedTasks.push(newTaskInstance);
      }
    });

    // Phase 3: Cleanup deleted tasks
    for (const [key, task] of this.#tasks) {
      if (task.#data.deleted && !task.#isDirty) {
        this.#tasks.delete(key);
        removedTasks.push(task);
      }
    }

    // Phase 5: Update the static sync token
    this.#syncToken = syncToken;
  }

  /** Recursively duplicates a task and its children. */
  static duplicate(originalTask: Task | null, idMap = new Map<string, string>(), newParentId: string | null = null): Task | null {
    if (!originalTask) {
      console.warn("Cannot duplicate root or undefined task.");
      return null;
    }

    if (idMap.has(originalTask.id)) {
      return this.getTaskById(idMap.get(originalTask.id)!) || null;
    }

    const newId = this.generateId();
    idMap.set(originalTask.id, newId);

    const originalDependencyIds = [...originalTask.dependencyIds];

    const newChildData: TaskData = {
      ...originalTask.#data,
      id: newId,
      parentId: newParentId,
      isCompleted: false,
      isNew: true,
      deleted: false,
      dependencyIds: []
    };

    const duplicatedTask = new Task(newChildData);
    duplicatedTask.#markDirty();

    originalTask.children.forEach(child => {
      this.duplicate(child, idMap, duplicatedTask.id);
    });

    const resolvedDependencyIds = originalDependencyIds
      .map(depId => idMap.get(depId) || depId)
      .filter(id => this.getTaskById(id));

    if (JSON.stringify(duplicatedTask.dependencyIds) !== JSON.stringify(resolvedDependencyIds)) {
      duplicatedTask.#setProperty('dependencyIds', resolvedDependencyIds);
    }

    return duplicatedTask;
  }

  //#endregion

  constructor(data: TaskData) {
    if (data.id === undefined) {
      data.id = Task.generateId();
      data.isNew = true;
      this.#markDirty();
    }

    if (Task.#tasks.has(data.id)) {
      throw new Error(`Task with ID '${data.id}' already exists.`);
    }

    if (!data.title) {
      throw new Error("Task title is required.");
    }

    this.#data = {
      ...data,
      isCompleted: data.isCompleted === true,
      parentId: data.parentId === undefined ? null : data.parentId,
      dependencyIds: Array.isArray(data.dependencyIds) ? [...data.dependencyIds] : [],
      sortOrder: data.sortOrder !== undefined ? data.sortOrder : 0
    };

    Task.#tasks.set(this.id, this);
  }

  //#region instance private fields

  #data: TaskData;
  #isDirty: boolean = false;

  //#endregion

  //#region Getters

  get id(): string { return this.#data.id!; }
  get title(): string { return this.#data.title; }
  get parentId(): string | null { return this.#data.parentId === "" ? null : (this.#data.parentId || null); }
  get dependencyIds(): string[] { return [...(this.#data.dependencyIds || [])]; }
  get parent(): Task | null { return this.parentId ? Task.getTaskById(this.parentId) || null : null; }
  get sortOrder(): number { return this.#data.sortOrder || 0; }

  get dependencies(): Task[] {
    return (this.#data.dependencyIds || [])
      .map(id => Task.getTaskById(id))
      .filter((t): t is Task => !!t);
  }

  get completionDate(): Date | null {
    return this.#getDateProperty('completionDate');
  }

  get children(): Task[] {
    return Task.getChildrenForId(this.id);
  }

  get incompleteChildren(): Task[] {
    return this.children.filter(child => !child.isCompleted);
  }

  get childrenIds(): string[] {
    return this.children.map(task => task.id);
  }

  get delay(): Date | null {
    return this.#getDateProperty("delay");
  }

  get type(): 'todo' | 'folder' {
    return this.children.length > 0 ? "folder" : "todo";
  }

  get isCompleted(): boolean {
    if (this.type === 'todo') {
      return this.#getDateProperty("completionDate") !== null;
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

  get isActive(): boolean {
    return !this.isCompleted && !this.isWaiting;
  }

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
        }
      } else {
        (this.#data as any)[name] = value;
        this.#markDirty();
      }
    }
  }

  //#endregion

  //#region Public Instance Methods

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
    this.#setDateProperty('completionDate', new Date());
  }

  uncomplete(): void {
    if (this.type === 'folder') {
      console.warn("Folders cannot be directly uncompleted.");
      return;
    }
    this.#setDateProperty('completionDate', null);
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
    this.#setDateProperty('completionDate', date);
  }

  addDependency(dependencyTaskId: string): void {
    const depTask = Task.getTaskById(dependencyTaskId);
    if (!depTask) throw new Error(`Dependency task '${dependencyTaskId}' not found.`);
    if (depTask.id === this.id) throw new Error("A task cannot depend on itself.");
    if (this.parentId !== depTask.parentId) throw new Error('Dependency must be in the same folder.');
    if (depTask.hasDependency(this)) throw new Error("Circular dependency detected.");

    if (!(this.#data.dependencyIds || []).includes(dependencyTaskId)) {
      const newDependencies = [...(this.#data.dependencyIds || []), dependencyTaskId];
      const listener = this.#createTaskListener(depTask, ["isWaiting", "isCompleted", "isActive"]);
      depTask.on("taskUpdated", listener as any);
      this.#taskListeners.dependency.set(depTask, listener);
      this.#setProperty('dependencyIds', newDependencies);
    }
  }

  removeDependency(dependencyTaskId: string): void {
    const newDependencies = (this.#data.dependencyIds || []).filter(id => id !== dependencyTaskId);
    if (newDependencies.length !== (this.#data.dependencyIds || []).length) {
      const depTask = Task.getTaskById(dependencyTaskId);
      if (depTask && this.#taskListeners.dependency.has(depTask)) {
        depTask.off("taskUpdated", this.#taskListeners.dependency.get(depTask) as any);
        this.#taskListeners.dependency.delete(depTask);
      }
      this.#setProperty('dependencyIds', newDependencies);
    }
  }

  #addChild(childTaskInstance: Task): void {
    if (this.id === childTaskInstance.id) throw new Error("A task cannot add itself as a child.");
    if (childTaskInstance.parentId === this.id) return;
    if (childTaskInstance.hasDescendent(this)) throw new Error("Circular hierarchy detected.");

    childTaskInstance.#setProperty('parentId', this.id);
    const listener = this.#createTaskListener(childTaskInstance, ["isWaiting", "isCompleted", "isActive"]);
    childTaskInstance.on("taskUpdated", listener as any);
    this.#taskListeners.child.set(childTaskInstance, listener);
    this.#dispatchChange();
  }

  #removeChild(childTaskInstance: Task): void {
    this.#dispatchChange();
    const listener = this.#taskListeners.child.get(childTaskInstance);
    if (listener) {
      childTaskInstance.off("taskUpdated", listener as any);
      this.#taskListeners.child.delete(childTaskInstance);
    }
    this.children.forEach(child => child.removeDependency(childTaskInstance.id));
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
      Task.#dispatchGlobalChange({ type: 'tasksUpdated' });
    }
  }

  delete(): void {
    this.children.forEach(child => child.delete());
    this.#setProperty("deleted", true);
    Task.#dispatchGlobalChange({ type: 'tasksUpdated' });
  }

  toJSON(): TaskData {
    return { ...this.#data, dependencyIds: [...(this.#data.dependencyIds || [])] };
  }

  getAvailableDependencyList(): Task[] {
    return Task.getChildrenForId(this.parentId).filter(task =>
      (task !== this && !task.hasDependency(this) && !task.isCompleted) ||
      (this.dependencyIds.indexOf(task.id) !== -1)
    );
  }

  sortBefore(targetTask: Task): void {
    if (!(targetTask instanceof Task)) return;
    if (targetTask.id === this.id) return;
    if (this.parentId !== targetTask.parentId) return;

    const siblings = Task.getChildrenForId(this.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
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
      Task.#dispatchGlobalChange({ type: 'tasksUpdated', taskId: 'orderUpdated' });
    }
  }

  //#endregion
}