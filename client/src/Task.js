    /**
     * @typedef {object} TaskData
     * @property {string} [id] - The unique identifier for the task. If not provided, one will be generated.
     * @property {string} title - The title or name of the task.
     * @property {boolean} [isCompleted=false] - Whether the task is completed. Only applicable for 'todo' type tasks.
     * @property {string | null} [parentId=null] - The ID of the parent task/folder. Null for root tasks.
     * @property {string[]} [dependencyIds=[]] - An array of task IDs that must be completed before this task becomes active.
     * @property {string} [delay] - This optional property is an ISO string the task will not be active until after this date.
     * @property {boolean} [deleted] - This optional property only exists when it is true and signifies that the task has been deleted.
     * @property {boolean} [isNew] - This optional property only exists when it is true and signifies that the task has been created since the last sync and containse a temporary id.
     */

    /**
     * @template T - The type of the items in the updates array (e.g., ProjectData or TaskData).
     * @typedef {object} SyncTypePayload
     * @property {number|null} syncToken - The client's last known sync token for this type.
     * @property {T[]} updates - Array of dirty or new data objects of type T from the client.
     */

    /**
     * @typedef {object} IdMapping
     * @property {string} oldId - The temporary client-generated ID.
     * @property {string} newId - The permanent server-generated ID.
     */

    /**
     * @template T - The type of the items in the updates array (e.g., ProjectData or TaskData).
     * @typedef {object} SyncTypeResponse
     * @property {number|null} syncToken - The client's last known sync token for this type.
     * @property {T[]} updates - Array of dirty or new data objects of type T from the client.
     * @property {IdMapping[]} updatedIds - Array of ID mappings for newly created type T.
     */

    /**
     * Represents a single todo item or a folder containing other todo items.
     * Tasks are stored globally in a static Map for easy lookup and management.
     * All mutations trigger a 'taskUpdated' event via a static EventTarget.
     */
    class Task {
      //#region static

      //#region private

      /**
       * @private
       * @type {Map<string, Task>} - A static Map to store all Task instances, keyed by their ID.
       */
      static #tasks = new Map();

      /**
       * @private
       * @type {EventTarget} - A static EventTarget for dispatching global task-related events.
       */
      static #globalEventTarget = new EventTarget();

      /**
       * @private
       * @type {number} - A static sync token for incremental sync with a server
       */
      static #syncToken = void 0; // Static private field for the sync token

      /**
     * @private
     * Dispatches a 'tasksUpdated' CustomEvent via the static eventTarget.
     */
      static #dispatchGlobalChange(detail) {
        this.#globalEventTarget.dispatchEvent(new CustomEvent('tasksUpdated', { detail }));
      }

      //#endregion

      //#region static properties

      /** @type {boolean} */
      static get isDirty() {
        return [...this.#tasks.values()].some(task => task.#isDirty);
      }

      /** @type {SyncTypePayload<TaskData>} */
      static get syncData() {
        const syncToken = this.#syncToken;
        const updates = [...this.#tasks.values()].filter(task => task.#isDirty).map(task => task.toJSON());

        return { syncToken, updates };
      }

      // Add static getter for all tasks (useful for UI filtering/mapping)
      static get allTasks() {
        return [...this.#tasks.values()].filter(task => !task.#data.deleted);
      }

      //#endregion

      //#region methods

      /**
       * Generates a unique temporary ID for new tasks.
       * @returns {string} A unique ID string.
       */
      static generateId() {
        return "temp-" + (new Date().getTime().toString(16)) + "." + ("0000" + Math.floor(Math.random() * 0x10000).toString(16)).substring(-4);
      }

      /**
       * Retrieves a Task instance by its ID.
       * @param {string} id - The ID of the task to retrieve.
       * @returns {Task | undefined} The Task instance, or undefined if not found.
       */
      static getTaskById(id) {
        return Task.#tasks.get(id);
      }

      /**
       * Retrieves all direct child Task instances for a given parent ID.
       * @param {string | null} parentId - The ID of the parent task, or null for root tasks.
       * @returns {Task[]} An array of child Task instances.
       */
      static getChildrenForId(parentId) {
        return [...this.#tasks.values()].filter(task => task.parentId === parentId && !task.#data.deleted);
      }

      /**
       * Registers an event listener for global Task events.
       * @param {string} eventName - The name of the event to listen for (e.g., 'tasksUpdated').
       * @param {EventListenerOrEventListenerObject} handler - The event handler function.
       */
      static on(eventName, handler) {
        Task.#globalEventTarget.addEventListener(eventName, handler);
      }

      /**
       * Removes an event listener for global Task events.
       * @param {string} eventName - The name of the event.
       * @param {EventListenerOrEventListenerObject} handler - The event handler function to remove.
       */
      static off(eventName, handler) {
        Task.#globalEventTarget.removeEventListener(eventName, handler);
      }

      /**
        * Merges synchronization response data for tasks into the client-side Task collection.
        * This method handles updating IDs for new tasks, applying server-side updates/deletions,
        * and updating the sync token.
        * @param {SyncTypeResponse<TaskData>} responsePart - The tasks part of the SyncResponse from the server.
        * @returns {void}
        */
      static mergeSyncResponse({ syncToken, updates, updatedIds }) {
        const addedTasks = [];
        const updatedTasks = [];
        const removedTasks = [];

        //Step 1: update the oldId to the new Id before doing anything else. The project will also be included
        //in updates using the newId, so as long as the id matches, it will get updated when updates are processed
        updatedIds?.forEach(({ oldId, newId }) => {
          const task = this.#tasks.get(oldId);
          this.#tasks.delete(oldId);
          this.#tasks.set(newId, task);
          task.#data.id = newId;
        });

        // Phase 2: Process Deltas (updates, additions, deletions) from the server
        updates?.forEach(data => {
          const task = this.getTaskById(data.id);

          if (task !== void 0) {
            task.#data = { ...data }; // Use spread to ensure Date objects are handled by constructor in future
            task.#isDirty = false; // Task is now clean from server's perspective
            task.#dispatchChange(); // Notify instance listeners of update
            updatedTasks.push(task);
          } else {
            const newTaskInstance = new Task(data); // Constructor handles adding to Task.#tasks
            addedTasks.push(newTaskInstance);
          }
        });

        // Phase 3: Clean up Project.#projects array
        [...this.#tasks].forEach(([key, task]) => {
          if (task.#data.deleted && !task.#isDirty) {
            this.#tasks.delete(key);
            removedTasks.push(task);
          }
        });

        // Phase 4: Make sure all tasks are listening to their dependencies AND children
        // This is where we explicitly clear and re-add all listeners for a full sync
        [...this.#tasks.values()].forEach(task => {
          // Clear existing listeners before re-adding to prevent duplicates on sync
          task.#taskListeners.dependency.forEach((listener, depTask) => {
            depTask.off("taskUpdated", listener);
          });
          task.#taskListeners.dependency.clear();

          task.#taskListeners.child.forEach((listener, childTask) => {
            childTask.off("taskUpdated", listener);
          });
          task.#taskListeners.child.clear();

          task.#listenToDependents();             // Re-add current dependency listeners
          task.#listenToChildren();               // Re-add current child listeners
        });


        // Phase 5: Update the static sync token
        this.#syncToken = syncToken;

        // Phase 6: Notify Static Listeners for UI updates
        if (addedTasks.length > 0 || updatedTasks.length > 0 || removedTasks.length > 0) this.#dispatchGlobalChange({
          type: "tasksUpdated",
          addedTasks, updatedTasks, removedTasks
        });
      }

      /**
       * Recursively duplicates a task and all its children, resolving dependencies within the subtree.
       * This method uses a single pass by resolving dependencies after all children have been duplicated
       * and their new IDs are available in the shared idMap.
       * @param {Task | null} originalTask - The task instance to duplicate, or null to indicate root (which is not duplicated).
       * @param {Map<string, string>} idMap - A map to store oldId -> newId mappings during duplication.
       * @param {string | null} newParentId - The new parentId for the duplicated task.
       * @returns {Task | null} The newly created duplicated task instance, or null if originalTask was null.
       */
      static duplicate(originalTask, idMap = new Map(), newParentId = null) {
        // If originalTask is null or undefined (representing the root or an invalid task), do not duplicate.
        if (originalTask === void 0 || originalTask === null) {
          console.warn("Cannot duplicate the root folder or an undefined task. Select a specific sub-folder to duplicate.");
          return null;
        }

        // If this task has already been processed in this duplication run, return its new ID
        if (idMap.has(originalTask.id)) {
          return Task.getTaskById(idMap.get(originalTask.id));
        }

        // Create a new ID for the duplicated task
        const newId = Task.generateId();
        idMap.set(originalTask.id, newId);

        // Store original dependencies temporarily before creating the new task
        const originalDependencyIds = [...originalTask.#data.dependencyIds];

        const newChildData = {
          ...originalTask.#data,
          id: newId,
          parentId: newParentId, // Set the new parent ID
          isCompleted: false, // Duplicated tasks are typically uncompleted
          isNew: true, // Mark as new for sync purposes
          deleted: false, // Ensure it's not marked as deleted
          dependencyIds: [] // IMPORTANT: Clear dependencies initially
        };

        const duplicatedTask = new Task(newChildData);
        duplicatedTask.#markDirty();

        // Recursively duplicate children and set their new parentId
        // This step ensures that all direct children's new IDs are populated in idMap
        // before we attempt to resolve dependencies for the current duplicatedTask.
        originalTask.children.forEach(child => {
          Task.duplicate(child, idMap, duplicatedTask.id);
        });

        // NOW that all direct children (and their descendants) have been duplicated
        // and their new IDs are in the shared idMap, we can resolve the dependencies
        // for the current duplicatedTask.
        const resolvedDependencyIds = originalDependencyIds
          .map(depId => idMap.get(depId) || depId) // Map old depId to new depId, or keep if not copied
          .filter(id => Task.getTaskById(id)); // Ensure the dependency actually exists (original or copied)

        // Only update if the dependencies have actually changed to avoid unnecessary dispatches
        if (JSON.stringify(duplicatedTask.dependencyIds) !== JSON.stringify(resolvedDependencyIds)) {
          duplicatedTask.#setProperty('dependencyIds', resolvedDependencyIds);
        }

        originalTask.#listenToChildren();

        return duplicatedTask;
      }

      //#endregion

      //#endregion

      //#region instance

      /**
       * Creates a new Task instance.
       * @param {TaskData} data - The initial data for the task.
       * @throws {Error} If the ID is duplicated or title is missing.
       */
      constructor(data) {
        if (data.id === void 0) {
          data.id = Task.generateId();
          data.isNew = true;
          this.#markDirty();
        }
        if (Task.#tasks.has(data.id)) {
          throw new Error(`Task with ID '${id}' already exists.`);
        }
        if (!data.title) {
          throw new Error("Task title is required.");
        }

        data.isCompleted = data.isCompleted === true;
        data.parentId = data.parentId === undefined ? null : data.parentId;
        data.dependencyIds = Array.isArray(data.dependencyIds) ? [...data.dependencyIds] : [];
        data.sortOrder = data.sortOrder !== undefined ? data.sortOrder : 0

        this.#data = data;

        Task.#tasks.set(this.id, this);

        // Dependency listeners are now stitched up during mergeSyncResponse or addDependency
        // this.children.forEach(child => {
        //   this.#addChildListener(child);
        // });

        Task.#dispatchGlobalChange({ task: this, type: "added" });

      }

      //#region properties

      /**
       * @private
       * @type {TaskData} - Private property holding the mutable data for this task instance.
       */
      #data;

      /**
       * @private
       * @type {Map<string, (data => void)[]>} - An EventTarget for dispatching instance task-related events.
       */
      #eventTarget = new Map();

      /**
       * @private
       * @type {boolean} - A simple boolean for determining if the task has been updated since the last sync.
       */
      #isDirty = false;

      #taskListeners = {
        dependency: new Map(),
        child: new Map()
      };



      //#endregion

      //#region getters

      /**
       * @returns {string} The unique ID of the task.
       */
      get id() {
        return this.#data.id;
      }

      /**
       * @returns {string} The title of the task.
       */
      get title() {
        return this.#data.title;
      }

      /**
       * @returns {string | null} The ID of the parent task, or null if it's a root task.
       */
      get parentId() {
        return this.#data.parentId === "" ? null : this.#data.parentId;
      }

      /**
       * @returns {string[]} An array of IDs of tasks that this task depends on.
       */
      get dependencyIds() {
        return [...this.#data.dependencyIds]; // Return a copy to prevent direct mutation
      }

      /**
       * @returns {Task | null} The parent Task instance, or null if it's a root task.
       */
      get parent() {
        return this.#data.parentId ? Task.getTaskById(this.#data.parentId) : null;
      }

      /**
       * @returns {Task[]} An array of Task instances that this task depends on.
       */
      get dependencies() {
        return this.#data.dependencyIds
          .map(id => Task.getTaskById(id))
          .filter(Boolean); // Filter out any undefined/null if dependency ID doesn't exist
      }

      get completionDate() {
          return this.#getDateProperty('completionDate');
      }

      /**
       * @returns {Task[]} An array of direct child Task instances of this task.
       */
      get children() {
        return Task.getChildrenForId(this.id);
      }

      get incompleteChildren() {
        return this.children.filter(child => !child.isCompleted);
      }

      /**
       * @returns {string[]} An array of IDs of direct child tasks of this task.
       */
      get childrenIds() {
        return this.children.map(task => task.id);
      }
      
      get delay() {
        return this.#getDateProperty("delay");
      }

      /**
       * @returns {'todo' | 'folder'} The type of the task: 'todo' if it has no children, 'folder' otherwise.
       */
      get type() {
        return this.children.length > 0 ? "folder" : "todo";
      }

      /**
       * @returns {boolean} True if the task is completed. For 'todo' tasks, it's based on its internal status.
       * For 'folder' tasks, it's true only if all its direct children are completed (recursively).
       */
      get isCompleted() {
        if (this.type === 'todo') {
          return this.#getDateProperty("completionDate") !== null;
          //return this.#data.isCompleted;
        } else { // type === 'folder'
          return this.children.every(child => child.isCompleted);
        }
      }

      /**
       * @returns {boolean} True if the task is waiting for its dependencies to be completed, or if any of its ancestors are waiting.
       */
      get isWaiting() {
        const delay = this.delay;
        const dependsOnIncomplete = this.dependencies.some(dep => !dep.isCompleted);
        const ancestorIsWaiting = this.parent?.isWaiting === true;
        return (delay !== null && delay > new Date()) || dependsOnIncomplete || ancestorIsWaiting;
      }

      /**
       * @returns {boolean} True if the task is active (not completed and not waiting).
       */
      get isActive() {
        return !this.isCompleted && !this.isWaiting;
      }

      get sortOrder() {
        return this.#data.sortOrder;
      }

      //#endregion

      //#region private methods

      #markDirty() {
        this.#isDirty = true;
        debouncedSync();
      }

      /**
       * @private
       * Dispatches a 'taskUpdated' CustomEvent via the static eventTarget.
       */
      #dispatchEvent(type, data) {
        if (this.#eventTarget.has(type)) {
          this.#eventTarget.get(type).forEach(listener => {
            listener(data);
          })
        }
      }

      // Simplified #dispatchChange to directly call #dispatchEvent with consistent type
      #dispatchChange(detail = {}) {
        this.#dispatchEvent("taskUpdated", { task: this, type: "updated", ...detail });
      }

      #getDateProperty(name) {
        let value = this.#data[name];
        
        if(value === null || value === void 0) {
          return null;
        } else {
          value = new Date(value);
          if(isNaN(value)) {
            return null;
          } else {
            return value;
          }
        }
      }
      
      #setDateProperty(name, value) {
        if(value === null || value === "") {
          this.#setProperty(name, null);
          return;
        } else if(!(value instanceof Date)) {
          value = new Date(value);
        }
        
        if(isNaN(value.getTime())) {
          throw new Error("Invalid date.");
        }
        
        this.#setProperty(name, value.toISOString());
      }

      /**
       * @private
       * Updates a property in the private #data object and dispatches a 'taskUpdated' event.
       * @param {keyof TaskData} name - The name of the property to update.
       * @param {TaskData[keyof TaskData]} value - The new value for the property.
       */
      #setProperty(name, value) {
        const oldValue = this.#data[name];
        // Only update if the value is actually different to avoid unnecessary events
        if (oldValue !== value) { // Simplified comparison for primitives
          if (Array.isArray(oldValue) && Array.isArray(value)) {
            // Deep comparison for arrays
            if (oldValue.length !== value.length || !oldValue.every((val, i) => val === value[i])) {
              this.#data[name] = value;
              this.#markDirty();
              this.#dispatchChange({ name, oldValue, newValue: [...value] }); // Pass array copy
            }
          } else {
            this.#data[name] = value;
            this.#markDirty();
            this.#dispatchChange({ name, oldValue, newValue: value });
          }
        }
      }

      // #createTaskListener is no longer needed in its previous form,
      // as #listenToDependents now directly creates the necessary closure.
      // Keeping it for reference if needed for other types of listeners.
      #createTaskListener(task, currentStateOrProps) {
        const context = this;
        const dataStateCompare = [];
        const currentState = {};
        if (Array.isArray(currentStateOrProps)) {
          dataStateCompare.push(...currentStateOrProps);
          dataStateCompare.forEach(key => {
            currentState[key] = context[key];
          });
        } else {
          dataStateCompare = Object.keys(currentStateOrProps);
          dataStateCompare.forEach(key => {
            currentState[key] = currentStateOrProps[key];
          });
        }
        const listener = function () {
          if (dataStateCompare.some(key => currentState[key] !== context[key])) {
            context.#dispatchChange();
            dataStateCompare.forEach(key => {
              currentState[key] = context[key];
            });
          }
        }
        return listener;
      }

      /**
       * @private
       * Establishes listeners for this task on its dependencies.
       * This is called during sync or when a dependency is added.
       */
      #listenToDependents() {
        this.dependencies.forEach(dependency => {
          if (!this.#taskListeners.dependency.has(dependency)) {
            const listener = this.#createTaskListener(dependency, ["isWaiting", "isCompleted", "isActive"]);
            dependency.on("taskUpdated", listener);
            this.#taskListeners["dependency"].set(dependency, listener);
          }
        });
      }

      #listenToChildren() {
        this.children.forEach(child => {
          if (!this.#taskListeners.child.has(child)) {
            const listener = this.#createTaskListener(child, ["isWaiting", "isCompleted", "isActive"]);
            child.on("taskUpdated", listener);
            this.#taskListeners["child"].set(child, listener);
          }
        });
      }

      /**
       * @private
       * Checks if the given task is a descendent of this task (recursively).
       * @param {Task} task - The task to check.
       * @returns {boolean} True if the task is a descendent, false otherwise.
       */
      hasDescendent(task) {
        return this.children.includes(task) || this.children.some(child => child.hasDescendent(task));
      }

      hasDependency(task) {
        return this.dependencies.includes(task) || this.dependencies.some(dependent => dependent.hasDependency(task));
      }

      //#endregion

      //#region public methods

      /**
       * Marks a 'todo' task as completed. Throws an error if called on a 'folder' task.
       * @throws {Error} If called on a 'folder' task.
       */
      complete() {
        if (this.type === 'folder') {
          console.warn("Folders cannot be directly completed. Complete their children instead.");
          return;
        }
        this.#setDateProperty('completionDate', new Date());
      }

      /**
       * Marks a 'todo' task as uncompleted. Throws an error if called on a 'folder' task.
       * @throws {Error} If called on a 'folder' task.
       */
      uncomplete() {
        if (this.type === 'folder') {
          console.warn("Folders cannot be directly uncompleted.");
          return;
        }
        this.#setDateProperty('completionDate', null);
      }

      /**
       * Renames the task.
       * @param {string} newTitle - The new title for the task.
       */
      rename(newTitle) {
        if (!newTitle) {
          console.error("Task title cannot be empty.");
          return;
        }
        this.#setProperty('title', newTitle);
      }
      
      delayUntil(date) {
        this.#setDateProperty("delay", date);
      }
      
      completeOn(date) {
        this.#setDateProperty('completionDate', date);
      }

      /**
       * Adds a dependency to this task. The task will not be active until this dependency is completed.
       * @param {string} dependencyTaskId - The ID of the task to add as a dependency.
       * @throws {Error} If the dependency task does not exist, is the task itself, or is an ancestor.
       */
      addDependency(dependencyTaskId) {
        const depTask = Task.getTaskById(dependencyTaskId);
        if (!depTask) {
          throw new Error(`Dependency task with ID '${dependencyTaskId}' not found.`);
        }
        if (depTask.id === this.id) {
          throw new Error("A task cannot depend on itself.");
        }
        if (this.parentId !== depTask.parentId) {
          throw new Error('A dependency must be in the same folder.');
        }
        if (depTask.hasDependency(this)) {
          throw new Error(`Circular dependency: Task '${this.title}' is an predecessor of '${depTask.title}'.`);
        }

        if (!this.#data.dependencyIds.includes(dependencyTaskId)) {
          const newDependencies = [...this.#data.dependencyIds, dependencyTaskId];
          const listener = this.#createTaskListener(depTask, ["isWaiting", "isCompleted", "isActive"]);
          depTask.on("taskUpdated", listener);
          this.#taskListeners["dependency"].set(depTask, listener);
          this.#setProperty('dependencyIds', newDependencies);
        }
      }

      /**
       * Removes a dependency from this task.
       * @param {string} dependencyTaskId - The ID of the dependency task to remove.
       */
      removeDependency(dependencyTaskId) {
        const newDependencies = this.#data.dependencyIds.filter(id => id !== dependencyTaskId);
        if (newDependencies.length !== this.#data.dependencyIds.length) {
          const depTask = Task.getTaskById(dependencyTaskId);
          if (depTask && this.#taskListeners.dependency.has(depTask)) {
            depTask.off("taskUpdated", this.#taskListeners.dependency.get(depTask));
            this.#taskListeners.dependency.delete(depTask);
          }
          this.#setProperty('dependencyIds', newDependencies);
        }
      }

      /**
       * Adds a child task to this folder. This task becomes the parent of the child.
       * @param {Task} childTaskInstance - The Task instance to add as a child.
       * @throws {Error} If the child is already a child, is the parent itself, or is an ancestor of the parent.
       */
      #addChild(childTaskInstance) {
        if (this.id === childTaskInstance.id) {
          throw new Error("A task cannot add itself as a child.");
        }
        if (childTaskInstance.parentId === this.id) {
          throw new Error(`Task '${childTaskInstance.title}' is already a child of '${this.title}'.`);
        }
        try {
          if (childTaskInstance.hasDescendent(this)) {
            throw new Error(`Circular hierarchy: Cannot add '${childTaskInstance.title}' as a child of '${this.title}' because '${this.title}' is an ancestor of '${childTaskInstance.title}'.`);
          }
        } catch (e) {
          throw new Error("cant call childTaskInstance.#hasDescendent()");
        }

        // Set the child's parentId, which will trigger child's own #dispatchChange
        childTaskInstance.#setProperty('parentId', this.id);
        const listener = this.#createTaskListener(childTaskInstance, ["isWaiting", "isCompleted", "isActive"]);
        childTaskInstance.on("taskUpdated", listener);
        this.#taskListeners["child"].set(childTaskInstance, listener);
        // Dispatch change for this parent, as its children collection has changed (type/completion might be affected)
        this.#dispatchChange();
      }

      #removeChild(childTaskInstance) {
        this.#dispatchChange();
        childTaskInstance.off("taskUpdated", this.#taskListeners.child.get(childTaskInstance));
        this.children.forEach(child => child.removeDependency(childTaskInstance.id));
      }

      /**
       * Moves this task to a new parent folder (or to root if newParent is null).
       * It handles removing the task from its current parent and adding it to the new one.
       * Dependencies are cleared if the task moves to a different folder.
       * @param {Task | null} newParent - The new parent Task instance, or null to move to root.
       */
      moveTo(newParent) {
        // Store old parent for comparison
        const oldParent = this.parent;

        // Only proceed if the new parent is different from the current parent
        if (newParent !== oldParent) {
          // If there's a new parent, add this task as a child to the new parent
          if (newParent) {
            newParent.#addChild(this); // Call public addChild on the new parent
          } else {
            this.#setProperty("parentId", null);
          }

          // If the task currently has a parent, remove it from that parent's children
          if (oldParent) {
            oldParent.#removeChild(this); // Call public removeChild on the old parent
          }

          // Clear dependencies if the task moved to a *different* folder (i.e., parentId changed)
          // This is crucial because dependencies are only allowed among siblings.
          // If the parent changes, the old siblings are no longer valid dependencies.
          if (this.dependencyIds.length > 0) { // Only clear if there are dependencies
            this.dependencies.forEach(dependency => {
              this.removeDependency(dependency);
            })
          }
          Task.#dispatchGlobalChange();
        }
      }

      /**
     * Registers an event listener for instance Task events.
     * @param {string} eventName - The name of the event to listen for (e.g., 'taskUpdated').
     * @param {EventListenerOrEventListenerObject} handler - The event handler function.
     */
      on(eventName, handler) {
        if (!this.#eventTarget.has(eventName)) this.#eventTarget.set(eventName, []);
        this.#eventTarget.get(eventName).push(handler);
      }

      /**
       * Removes an event listener for instance Task events.
       * @param {string} eventName - The name of the event.
       * @param {EventListenerOrEventListenerObject} handler - The event handler function to remove.
       */
      off(eventName, handler) {
        if (!this.#eventTarget.has(eventName)) return;
        const index = this.#eventTarget.get(eventName).indexOf(handler);
        if (index > -1) {
          this.#eventTarget.get(eventName).splice(index, 1);
        }
      }

      delete() {
        this.children.forEach(child => child.delete());
        this.#setProperty("deleted", true);
        Task.#dispatchGlobalChange();
      }

      toJSON() {
        return { ...this.#data, dependencyIds: [...this.#data.dependencyIds] };
      }

      getAvailableDependencyList() {
        return Task.getChildrenForId(this.parentId).filter(task => (task !== this && !task.hasDependency(this) && !task.isCompleted) || (this.dependencies.indexOf(task) !== -1));
      }

      /**
       * Changes the sort order of this task to appear before another task.
       * The tasks must be siblings (have the same parentId, or both be root tasks).
       * @param {Task} targetTask - The task to sort this task before.
       * @throws {Error} If the target is not a Task instance, is not a sibling, or is the task itself.
       */
      sortBefore(targetTask) {
        if (!(targetTask instanceof Task)) {
          console.error("Can't sort a task before a non-task.");
          return;
        }
        if (targetTask.id === this.id) {
          console.warn("Cannot sort a task before itself.");
          return;
        }
        // Ensure both tasks are siblings (same parentId or both are root)
        if (this.parentId !== targetTask.parentId) {
          console.error("Tasks must be siblings (same parent or both root) to sort directly against each other.");
          return;
        }

        // Get all siblings, including this task and the target task, sorted by current sortOrder
        const siblings = Task.getChildrenForId(this.parentId).sort((a, b) => a.sortOrder - b.sortOrder);

        // Find the current task's index in the sorted list
        const oldIndex = siblings.findIndex(t => t.id === this.id);
        if (oldIndex === -1) { // This task isn't in the list of its supposed siblings (shouldn't happen)
          console.warn(`Task ${this.id} not found in its sibling list for sorting.`);
          return;
        }

        // Remove the current task from its old position
        siblings.splice(oldIndex, 1);

        // Find the target task's index (where the current task should be inserted before) in the modified list
        const targetIndex = siblings.findIndex(t => t.id === targetTask.id);
        if (targetIndex === -1) { // Target task isn't in the list of siblings (shouldn't happen)
          console.warn(`Target task ${targetTask.id} not found in sibling list for sorting.`);
          return;
        }

        // Insert the current task at the target index
        siblings.splice(targetIndex, 0, this);

        let changed = false;
        // Iterate through the reordered siblings and update their sortOrder
        siblings.forEach((taskInstance, index) => {
          // Only update if the sortOrder has actually changed to minimize dirty flags
          if (taskInstance.#data.sortOrder !== index) {
            taskInstance.#data.sortOrder = index;
            taskInstance.#markDirty();
            changed = true;
          }
        });

        if (changed) {
          // Notify global listeners that tasks have been updated (their order changed)
          // The `detail` can be more specific if needed, but a general 'taskChanged' often suffices.
          Task.#dispatchGlobalChange({ type: 'tasksUpdated', taskId: 'orderUpdated' });
        }
      }
      //#endregion

      //#endregion
    }