const taskListContainer = document.getElementById('taskListContainer');
const taskItemTemplate = document.getElementById('taskItemTemplate');
const noTasksMessage = document.getElementById('noTasksMessage');
const folderTree = document.getElementById('folderTree');
const treeNodeTemplate = document.getElementById('treeNodeTemplate');
const duplicateFolderBtn = document.getElementById('duplicateFolderBtn');
const addTasksBtn = document.getElementById('addTasksBtn');
const addTaskDialogTemplate = document.getElementById('addTaskDialogTemplate');
const taskDetailsPanel = document.getElementById('taskDetailsPanel');
const noTaskSelectedMessage = document.getElementById('noTaskSelectedMessage');
const confirmationDialogTemplate = document.getElementById('confirmationDialogTemplate');
const syncNowBtn = document.getElementById('syncNowBtn');

let currentParentId = null; // Represents the ID of the folder whose children are currently displayed
let dragSrcEl = null; // Element being dragged (main area task-item)
let dragMode = 'sort'; // 'sort' or 'move'
let currentDetailedTask = null; // The Task instance currently displayed in the right panel

// --- Drag & Drop Mode Toggle ---
const modeToggleBtn = document.getElementById('modeToggle');
modeToggleBtn.addEventListener('click', () => {
  if (dragMode === 'sort') {
    dragMode = 'move';
    modeToggleBtn.textContent = 'Current Mode: Move';
  } else {
    dragMode = 'sort';
    modeToggleBtn.textContent = 'Current Mode: Sort';
  }
});

// --- Filter Dropdown Logic ---
const filterDropdown = document.getElementById('filterDropdown');
const filterAll = document.getElementById('filterAll');
const filterWaiting = document = document.getElementById('filterWaiting');
const filterActive = document.getElementById('filterActive');
const filterCompleted = document.getElementById('filterCompleted');

filterDropdown.querySelector('.filter-button').addEventListener('click', (event) => {
  event.stopPropagation(); // Prevent closing immediately if clicked on button
  filterDropdown.classList.toggle('active');
});

// Close dropdown if clicked outside
window.addEventListener('click', (event) => {
  if (!filterDropdown.contains(event.target)) {
    filterDropdown.classList.remove('active');
  }
});

function updateFilterAttributes() {
  const allAreChecked = filterWaiting.checked && filterActive.checked && filterCompleted.checked;

  if(filterAll.checked !== allAreChecked) {
    filterAll.checked = allAreChecked;
  }
  // Note: data-hide-X="true" means hide X. So if checkbox is CHECKED, we DON'T hide.
  taskListContainer.setAttribute('data-hide-waiting', !filterWaiting.checked);
  taskListContainer.setAttribute('data-hide-active', !filterActive.checked);
  taskListContainer.setAttribute('data-hide-completed', !filterCompleted.checked);
}

filterAll.addEventListener('change', () => {
  const isChecked = filterAll.checked;

  const allAreChecked = filterWaiting.checked && filterActive.checked && filterCompleted.checked;
  const someAreNotChecked = !filterWaiting.checked || filterActive.checked || filterCompleted.checked;

  if(!isChecked && allAreChecked) {
    filterWaiting.checked = false;
    filterActive.checked = false;
    filterCompleted.checked = false;
  } if(isChecked && someAreNotChecked) {
    filterWaiting.checked = true;
    filterActive.checked = true;
    filterCompleted.checked = true;
  }

  updateFilterAttributes();
});

filterWaiting.addEventListener('change', updateFilterAttributes);
filterActive.addEventListener('change', updateFilterAttributes);
filterCompleted.addEventListener('change', updateFilterAttributes);

// Initial filter setup
updateFilterAttributes();


// --- Task Rendering and Event Handling (Main Area) ---

/**
 * Renders a single Task instance into a DOM element.
 * @param {Task} taskInstance - The Task object to render.
 * @returns {HTMLElement} The rendered task element.
 */
function renderTask(taskInstance) {
  const clone = document.importNode(taskItemTemplate.content, true);
  const taskElement = clone.querySelector('.task-item');
  const checkbox = taskElement.querySelector('.task-complete-checkbox');
  const titleDiv = taskElement.querySelector('.task-title');

  taskElement.dataset.taskId = taskInstance.id;
  titleDiv.textContent = taskInstance.title;

  // Update checkbox visibility and state
  updateTaskCheckbox(taskElement, taskInstance);

  // Update CSS classes based on status
  updateTaskStatusClasses(taskElement, taskInstance);

  // Add event listener for checkbox
  checkbox.addEventListener('change', (event) => {
    if (event.target.checked) {
      taskInstance.complete();
    } else {
      taskInstance.uncomplete();
    }
  });

  // Add click listener to select task for details panel
  taskElement.addEventListener('click', (event) => {
    // Prevent click on checkbox from also selecting the task for details
    if (event.target !== checkbox) {
      displayTaskDetails(taskInstance);
    }
  });


  // Add drag and drop listeners
  taskElement.addEventListener('dragstart', handleDragStart);
  taskElement.addEventListener('dragover', handleDragOver);
  taskElement.addEventListener('dragleave', handleDragLeave);
  taskElement.addEventListener('drop', handleDrop);
  taskElement.addEventListener('dragend', handleDragEnd);

  // Listen for instance-specific updates to this task
  taskInstance.on('taskUpdated', (detail) => { // Changed from 'update' to 'taskUpdated'
    // console.log(`Instance update for ${taskInstance.title}:`, detail);
    // Re-render or update specific parts of the element
    if (detail.name === 'title') {
      titleDiv.textContent = taskInstance.title;
    }
    // Status changes (isCompleted, isWaiting, isActive) might affect classes or checkbox
    // Also type might change if children are added/removed, affecting checkbox
    if (['isCompleted', 'parentId', 'dependencyIds'].includes(detail.name) || detail.type === 'updated') { // Added dependencyIds
      updateTaskCheckbox(taskElement, taskInstance);
      updateTaskStatusClasses(taskElement, taskInstance);
      // If the type changed (e.g., folder to todo or vice versa), the tree view might need updating
      renderTreeView();
      // If this task is currently being detailed, refresh the detail panel
      if (currentDetailedTask && currentDetailedTask.id === taskInstance.id) {
        displayTaskDetails(taskInstance);
      }
    }
  });

  return taskElement;
}

/**
 * Updates the checkbox visibility and checked state for a task element.
 * @param {HTMLElement} taskElement - The DOM element representing the task.
 * @param {Task} taskInstance - The corresponding Task object.
 */
function updateTaskCheckbox(taskElement, taskInstance) {
  const checkboxContainer = taskElement.querySelector('.task-checkbox');
  const checkbox = checkboxContainer.querySelector('input[type="checkbox"]');
  const folderIcon = taskElement.querySelector('.task-folder-icon');

  if (taskInstance.type === 'todo') {
    checkboxContainer.style.display = 'flex'; // Show checkbox
    checkbox.checked = taskInstance.isCompleted;
    checkbox.disabled = taskInstance.isWaiting; // Disable if waiting
    folderIcon.style.display = 'none';
  } else { // type === 'folder'
    checkboxContainer.style.display = 'none'; // Hide checkbox
    folderIcon.style.display = 'flex';
    checkbox.checked = false; // Ensure it's unchecked if hidden
  }
}

/**
 * Updates the CSS status classes for a task element.
 * @param {HTMLElement} taskElement - The DOM element representing the task.
 * @param {Task} taskInstance - The corresponding Task object.
 */
function updateTaskStatusClasses(taskElement, taskInstance) {
  taskElement.classList.remove('waiting', 'active', 'completed');
  if (taskInstance.isWaiting) {
    taskElement.classList.add('waiting');
  } else if (taskInstance.isActive) {
    taskElement.classList.add('active');
  } else if (taskInstance.isCompleted) {
    taskElement.classList.add('completed');
  }
}

/**
 * Displays tasks for the currentParentId in the main content area.
 * @param {string | null} parentId - The ID of the parent whose children to display.
 */
function displayTasks(parentId) {
  currentParentId = parentId;
  taskListContainer.innerHTML = ''; // Clear existing tasks

  const tasksToDisplay = Task.getChildrenForId(parentId).sort((a, b) => a.sortOrder - b.sortOrder); // Ensure sorted display

  if (tasksToDisplay.length === 0) {
    noTasksMessage.style.display = 'block';
  } else {
    noTasksMessage.style.display = 'none';
    tasksToDisplay.forEach(task => {
      taskListContainer.appendChild(renderTask(task));
    });
  }
  // Update tree node selection, but don't clear task details here.
  // Detail panel update is handled by explicit click on task-item or taskUpdated listener.
  updateSelectedTreeNode(parentId);
}

// --- Tree View Rendering and Event Handling ---
let currentSelectedNodeElement = null; // Keep track of the currently selected tree node element

/**
 * Renders a single tree node (folder or root).
 * @param {Task | null} taskInstance - The Task object for the folder, or null for the root.
 * @returns {HTMLElement} The rendered tree node element.
 */
function renderTreeNode(taskInstance) {
  const clone = document.importNode(treeNodeTemplate.content, true);
  const nodeElement = clone.querySelector('.tree-node');
  const nodeContent = nodeElement.querySelector('.tree-node-content'); // Get the new content wrapper
  const toggleIcon = nodeContent.querySelector('.toggle-icon');
  const folderIcon = nodeContent.querySelector('.tree-node-icon');
  const titleSpan = nodeContent.querySelector('.tree-node-title');

  const isRoot = taskInstance === null;
  const nodeId = isRoot ? 'root' : taskInstance.id;
  const nodeTitle = isRoot ? 'Root' : taskInstance.title;
  const hasChildrenFolders = isRoot ? Task.getChildrenForId(null).some(t => t.type === 'folder') : taskInstance.children.some(t => t.type === 'folder');


  nodeElement.dataset.nodeId = nodeId;
  nodeElement.dataset.isFolder = !isRoot; // Mark if it's an actual folder task
  nodeElement.dataset.hasChildren = hasChildrenFolders; // Indicate if it has collapsable children
  titleSpan.textContent = nodeTitle;

  if (isRoot) {
    nodeElement.classList.add('root-node');
    folderIcon.classList.remove('fa-folder');
    folderIcon.classList.add('fa-home'); // Home icon for root
    toggleIcon.style.visibility = 'hidden'; // Root doesn't collapse its own list
  } else {
    nodeElement.classList.add('folder-node');
    // folderIcon is already fa-folder from template
    if (!hasChildrenFolders) {
      toggleIcon.style.visibility = 'hidden'; // Hide toggle if no children folders
    }
  }

  // Set initial collapsed state (default to expanded)
  nodeElement.classList.remove('collapsed'); // Ensure it starts expanded

  // Click listener for the toggle icon
  toggleIcon.addEventListener('click', (event) => {
    event.stopPropagation(); // Prevent node selection when clicking toggle
    nodeElement.classList.toggle('collapsed');
  });

  // Click listener to display children in main area, attached to the content wrapper
  nodeContent.addEventListener('click', (event) => {
    event.stopPropagation(); // Stop bubbling to parent tree nodes
    // Remove selection from previous node
    if (currentSelectedNodeElement) {
      currentSelectedNodeElement.classList.remove('selected');
    }
    // Add selection to current node
    nodeElement.classList.add('selected');
    currentSelectedNodeElement = nodeElement;

    displayTasks(isRoot ? null : taskInstance.id);
    displayTaskDetails(isRoot ? null : taskInstance); // Clear task details when changing folders
  });

  // Drag and Drop for tree nodes (as drop targets)
  nodeElement.addEventListener('dragover', handleTreeDragOver);
  nodeElement.addEventListener('dragleave', handleTreeDragLeave);
  nodeElement.addEventListener('drop', handleTreeDrop);

  return nodeElement;
}

/**
 * Recursively renders the folder tree.
 * @param {HTMLElement} parentElement - The UL element to append children to.
 * @param {string | null} parentId - The ID of the parent folder, or null for root.
 * @param {number} level - Current indentation level.
 */
function buildTree(parentElement, parentId) {
  const folders = Task.getChildrenForId(parentId).filter(task => task.type === 'folder').sort((a, b) => a.sortOrder - b.sortOrder); // Ensure sorted display

  folders.forEach(folder => {
    const nodeElement = renderTreeNode(folder);
    parentElement.appendChild(nodeElement);

    // Create a sub-list for children if this folder has children
    const childrenFolders = folder.children.filter(child => child.type === 'folder');
    if (childrenFolders.length > 0) {
      const subList = document.createElement('ul');
      subList.classList.add('tree-view');
      nodeElement.appendChild(subList);
      buildTree(subList, folder.id); // Recurse for children
    }
  });
}

function renderTreeView() {
  folderTree.innerHTML = ''; // Clear existing tree

  // Add the root node
  const rootNodeElement = renderTreeNode(null);
  folderTree.appendChild(rootNodeElement);

  // Build the rest of the tree
  buildTree(folderTree, null);

  // Re-select the previously selected node if it still exists
  updateSelectedTreeNode(currentParentId);
}

/**
 * Updates the 'selected' class on tree nodes based on currentParentId.
 * @param {string | null} selectedId - The ID of the task/folder whose children are currently displayed.
 */
function updateSelectedTreeNode(selectedId) {
  if (currentSelectedNodeElement) {
    currentSelectedNodeElement.classList.remove('selected');
  }
  const targetNodeId = selectedId === null ? 'root' : selectedId;
  const newSelectedNode = folderTree.querySelector(`[data-node-id="${targetNodeId}"]`);
  if (newSelectedNode) {
    newSelectedNode.classList.add('selected');
    currentSelectedNodeElement = newSelectedNode;
  }
}


// --- Global Task Event Listener ---
Task.on('tasksUpdated', (event) => {
  // console.log('Global tasksUpdated event:', event.detail);
  // Re-render the current view whenever tasks change globally
  // This handles additions, deletions, and property changes that affect status/type
  displayTasks(currentParentId);
  renderTreeView(); // Also re-render the tree view
  // If the currently detailed task was affected by the update, refresh its panel
  if (currentDetailedTask && event.detail.task && currentDetailedTask.id === event.detail.task.id) {
    displayTaskDetails(currentDetailedTask);
  }
});

// --- Drag and Drop Handlers (Main Area) ---
function handleDragStart(e) {
  dragSrcEl = this; // 'this' refers to the task-item being dragged
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.taskId); // Store task ID
  this.classList.add('dragging');
}

function handleDragOver(e) {
  e.preventDefault(); // Necessary to allow dropping
  e.dataTransfer.dropEffect = 'move';

  const targetElement = e.currentTarget; // The element the drag is currently over
  if (targetElement.classList.contains('task-item') && targetElement !== dragSrcEl) {
    if (dragMode === 'sort') {
      targetElement.classList.add('drag-over-sort');
    } else { // move mode
      targetElement.classList.add('drag-over-move');
    }
  }
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-sort', 'drag-over-move');
}

function handleDrop(e) {
  e.stopPropagation(); // Prevents the event from bubbling up to parent elements
  e.preventDefault();

  const targetElement = e.currentTarget;
  targetElement.classList.remove('drag-over-sort', 'drag-over-move');

  if (dragSrcEl !== targetElement) { // Ensure it's not dropping on itself
    const draggedTaskId = e.dataTransfer.getData('text/plain');
    const droppedTask = Task.getTaskById(draggedTaskId);
    const targetTask = Task.getTaskById(targetElement.dataset.taskId);

    if (!droppedTask || !targetTask) {
      console.error("Dragged or target task not found.");
      return;
    }

    if (dragMode === 'sort') {
      // Sort mode: Reorder the dragged task before the target task
      droppedTask.sortBefore(targetTask);
    } else { // move mode
      // Move mode: Make the dropped task a child of the target task
      droppedTask.moveTo(targetTask); // Use the new moveTo method
    }
  }
  // displayTasks(currentParentId); // Global event listener will handle re-render
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  // Remove any drag-over classes from all elements
  document.querySelectorAll('.task-item, .tree-node').forEach(item => {
    item.classList.remove('drag-over-sort', 'drag-over-move');
  });
}

// --- Drag and Drop Handlers (Tree View - Drop Targets Only) ---
function handleTreeDragOver(e) {
  e.preventDefault(); // Necessary to allow dropping
  e.dataTransfer.dropEffect = 'move';
  const targetNode = e.currentTarget;
  targetNode.classList.add('drag-over-move');
}

function handleTreeDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-move');
}

function handleTreeDrop(e) {
  e.stopPropagation();
  e.preventDefault();
  this.classList.remove('drag-over-move');

  const draggedTaskId = e.dataTransfer.getData('text/plain');
  const droppedTask = Task.getTaskById(draggedTaskId);
  const targetNodeId = this.dataset.nodeId;
  const targetTask = targetNodeId === 'root' ? null : Task.getTaskById(targetNodeId);

  if (!droppedTask) {
    console.error("Dragged task not found.");
    return;
  }

  // Prevent dropping a task onto itself or its own descendant
  if (droppedTask.id === targetNodeId) {
    console.warn("Cannot drop a task onto itself.");
    return;
  }
  // Basic check to prevent dropping a parent into its own child (circular dependency)
  // This would require a more robust `hasDescendent` check in the Task class.
  let current = targetTask;
  while (current) {
    if (current.id === droppedTask.id) {
      console.warn("Cannot move a task into its own descendant.");
      return;
    }
    current = current.parent;
  }

  // Use the new moveTo method
  droppedTask.moveTo(targetTask);
  // Global event listener will handle re-render of both main list and tree view
}

// --- Folder Duplication Logic ---
duplicateFolderBtn.addEventListener('click', () => {
  const selectedFolder = Task.getTaskById(currentParentId); // Will be null if root is selected
  Task.duplicate(selectedFolder); // Task.duplicate now handles the null/undefined case internally
});

// --- Add Tasks Dialog Logic ---
addTasksBtn.addEventListener('click', () => {
  const clone = document.importNode(addTaskDialogTemplate.content, true);
  const dialog = clone.querySelector('#addTaskDialog');
  const textarea = dialog.querySelector('#taskTitlesInput');
  const okButton = dialog.querySelector('.ok-button');
  const cancelButton = dialog.querySelector('.cancel-button');

  document.body.appendChild(dialog); // Append to body to show it as a modal

  okButton.addEventListener('click', () => {
    const titles = textarea.value.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const parentIdForNewTasks = currentParentId; // Add to currently selected folder

    titles.forEach(title => {
      new Task({ title: title, parentId: parentIdForNewTasks });
    });
    dialog.close();
    dialog.remove(); // Clean up dialog from DOM
  });

  cancelButton.addEventListener('click', () => {
    dialog.close();
    dialog.remove(); // Clean up dialog from DOM
  });

  dialog.showModal(); // Show the dialog as a modal
});

// --- Custom Confirmation Dialog Logic ---
/**
 * Displays a custom confirmation dialog.
 * @param {string} message - The message to display in the dialog.
 * @returns {Promise<boolean>} A promise that resolves to true if confirmed, false if cancelled.
 */
function showConfirmationDialog(message) {
  return new Promise((resolve) => {
    const clone = document.importNode(confirmationDialogTemplate.content, true);
    const dialog = clone.querySelector('#confirmationDialog');
    const msgElement = dialog.querySelector('#confirmationMessage');
    const confirmButton = dialog.querySelector('.confirm-ok-button');
    const cancelButton = dialog.querySelector('.confirm-cancel-button');

    msgElement.textContent = message;
    document.body.appendChild(dialog);

    const cleanup = () => {
      dialog.close();
      dialog.remove();
    };

    confirmButton.addEventListener('click', () => {
      resolve(true);
      cleanup();
    }, { once: true }); // Use once: true to automatically remove listener

    cancelButton.addEventListener('click', () => {
      resolve(false);
      cleanup();
    }, { once: true }); // Use once: true to automatically remove listener

    dialog.showModal();
  });
}

// --- Task Details Panel Logic ---
/**
 * Displays the details of a given task in the right panel.
 * @param {Task | null} taskInstance - The task to display, or null to clear the panel.
 */
function displayTaskDetails(taskInstance) {
  // Remove previous listener if a task was being detailed
  if (currentDetailedTask) {
    currentDetailedTask.off('taskUpdated', refreshDetailPanel);
  }

  taskDetailsPanel.innerHTML = ''; // Clear existing content

  if (taskInstance === null) {
    noTaskSelectedMessage.style.display = 'block';
    taskDetailsPanel.appendChild(noTaskSelectedMessage);
    currentDetailedTask = null;
    return;
  }

  noTaskSelectedMessage.style.display = 'none'; // Hide "no task selected" message

  // Title Section
  const titleSection = document.createElement('div');
  titleSection.classList.add('detail-section');
  titleSection.innerHTML = `
                <label for="detailTaskTitle">Task Title:</label>
                <input type="text" id="detailTaskTitle" class="detail-input">
            `;
  const titleInput = titleSection.querySelector('#detailTaskTitle');
  titleInput.value = taskInstance.title;
  titleInput.addEventListener('change', (event) => {
    taskInstance.rename(event.target.value);
  });
  taskDetailsPanel.appendChild(titleSection);

  const completedSection = document.createElement('div');
  completedSection.classList.add('detail-section');
  completedSection.innerHTML = `
                <label for="detailTaskCompleted">Completed:</label>
                <input type="date" id="detailTaskCompleted" class="detail-input">
            `;
  const completedInput = completedSection.querySelector('#detailTaskCompleted');
  completedInput.valueAsDate = taskInstance.completionDate;
  completedInput.addEventListener('change', (event) => {
    taskInstance.completeOn(event.target.value);
  });
  taskDetailsPanel.appendChild(completedSection);

  const delaySection = document.createElement('div');
  delaySection.classList.add('detail-section');
  delaySection.innerHTML = `
                <label for="detailTaskDelay">Delay:</label>
                <input type="date" id="detailTaskDelay" class="detail-input">
            `;
  const delayInput = delaySection.querySelector('#detailTaskDelay');
  delayInput.valueAsDate = taskInstance.delay;
  delayInput.addEventListener('change', (event) => {
    taskInstance.delayUntil(event.target.value);
  });
  taskDetailsPanel.appendChild(delaySection);

  const deleteButton = document.createElement('button');
  deleteButton.classList.add('delete-button');
  deleteButton.textContent = "Delete Task";
  deleteButton.addEventListener("click", async () => {
    const confirmed = await showConfirmationDialog(`Are you sure you want to delete "${taskInstance.title}"? This action cannot be undone.`);
    if (confirmed) {
      taskInstance.delete();
      displayTaskDetails(null); // Clear panel after deletion
    }
  });
  deleteButton.innerText = "Delete";
  taskDetailsPanel.appendChild(deleteButton);

  // Dependencies Section
  const dependenciesSection = document.createElement('div');
  dependenciesSection.classList.add('detail-section');
  dependenciesSection.innerHTML = `<h3>Dependencies</h3><div id="detailDependencyList"></div>`;
  const dependencyListDiv = dependenciesSection.querySelector('#detailDependencyList');

  const availableDependencies = taskInstance.getAvailableDependencyList();

  if (availableDependencies.length === 0) {
    const noDependenciesMsg = document.createElement('p');
    noDependenciesMsg.textContent = "No available dependencies in this folder.";
    noDependenciesMsg.style.fontStyle = 'italic';
    noDependenciesMsg.style.color = '#888';
    dependencyListDiv.appendChild(noDependenciesMsg);
  } else {
    availableDependencies.forEach(dep => {
      const dependencyItem = document.createElement('div');
      dependencyItem.classList.add('dependency-item');
      const isCurrentlyDependent = taskInstance.dependencyIds.includes(dep.id);

      const idProperty = (`dep-${dep.id}`.replaceAll(".", "-"));

      dependencyItem.innerHTML = `
                        <input type="checkbox" id="${idProperty}" ${isCurrentlyDependent ? 'checked' : ''}>
                        <label for="${idProperty}">${dep.title}</label>
                    `;
      const depCheckbox = dependencyItem.querySelector(`#${idProperty}`);

      depCheckbox.addEventListener('change', (event) => {
        if (event.target.checked) {
          taskInstance.addDependency(dep.id);
        } else {
          taskInstance.removeDependency(dep.id);
        }
      });
      dependencyListDiv.appendChild(dependencyItem);
    });
  }
  taskDetailsPanel.appendChild(dependenciesSection);

  // Set the currently detailed task and add a listener to it for refreshing
  currentDetailedTask = taskInstance;
  currentDetailedTask.on('taskUpdated', refreshDetailPanel);
}

// Helper function to refresh the detail panel if the currentDetailedTask changes
function refreshDetailPanel() {
  if (currentDetailedTask) {
    displayTaskDetails(currentDetailedTask);
  }
}

// --- Sync Now Button Logic ---
syncNowBtn.addEventListener('click', async () => {
  syncNowBtn.disabled = true;
  syncNowBtn.textContent = 'Syncing...';
  try {
    await sync(); // Call the non-debounced sync function
    syncNowBtn.textContent = 'Sync Now';
  } catch (error) {
    console.error("Manual sync failed:", error);
    syncNowBtn.textContent = 'Sync Failed!';
    // Optionally, revert after a few seconds
    setTimeout(() => { syncNowBtn.textContent = 'Sync Now'; }, 3000);
  } finally {
    syncNowBtn.disabled = false;
  }
});

// Add this line with your other element references
const showFilteredTasksBtn = document.getElementById('showFilteredTasksBtn');

// Add an event listener to the new button
showFilteredTasksBtn.addEventListener('click', () => {
    showFilteredTasksDialog();
});

// A new function to get the full path of a task
function getTaskPath(taskInstance) {
    const path = [];
    let currentTask = taskInstance;

    while (currentTask && currentTask.parentId) {
        currentTask = Task.getTaskById(currentTask.parentId);
        if (currentTask) {
            path.unshift(currentTask.title);
        }
    }
    path.unshift('Root');
    return path.join(' > ');
}

// A new function to render a task for the dialog
function renderFilteredTask(taskInstance, dialog) {
    const clone = document.importNode(taskItemTemplate.content, true);
    const taskElement = clone.querySelector('.task-item');
    const checkbox = taskElement.querySelector('.task-complete-checkbox');
    const titleDiv = taskElement.querySelector('.task-title');
    const folderIcon = taskElement.querySelector('.task-folder-icon');

    taskElement.dataset.taskId = taskInstance.id;
    taskElement.style.cursor = 'pointer'; // Make it visually clear that it's clickable

    titleDiv.textContent = taskInstance.title;

    // Add the path as a new label under the title
    const pathLabel = document.createElement('div');
    pathLabel.classList.add('task-path-label');
    pathLabel.textContent = getTaskPath(taskInstance);
    titleDiv.appendChild(pathLabel);

    // Update the visual state
    updateTaskCheckbox(taskElement, taskInstance);
    updateTaskStatusClasses(taskElement, taskInstance);
    
    // Clicking the task item in the dialog should navigate to its folder
    taskElement.addEventListener('click', () => {
        // Navigate to the task's parent folder
        displayTasks(taskInstance.parentId);
        renderTreeView();
        
        // Close the dialog
        dialog.close();
        dialog.remove();
    });

    return taskElement;
}

// A new function to show the dialog with filtered tasks
function showFilteredTasksDialog() {
    const clone = document.importNode(filteredTasksDialogTemplate.content, true);
    const dialog = clone.querySelector('#filteredTasksDialog');
    const taskListContainer = dialog.querySelector('#filteredTaskListContainer');
    const closeButton = dialog.querySelector('.ok-button');


// Recursive function to get all tasks in a folder and its subfolders
    function getTasksInFolderRecursive(folderId) {
        let tasks = [];
        const children = Task.getChildrenForId(folderId);
        
        children.sort((a, b) => a.sortOrder - b.sortOrder).forEach(child => {
            if (child.type === 'todo') {
                tasks.push(child);
            } else { // It's a folder
                tasks = tasks.concat(getTasksInFolderRecursive(child.id));
            }
        });
        return tasks;
    }

    // Get tasks from the current folder and all its subfolders
    const allTasks = getTasksInFolderRecursive(currentParentId);
    const filteredTasks = allTasks.filter(task => {
        const isWaiting = task.isWaiting;
        const isActive = task.isActive;
        const isCompleted = task.isCompleted;

        if(task.type === "folder") return false;

        if (filterWaiting.checked && isWaiting) {
            return true;
        }
        if (filterActive.checked && isActive) {
            return true;
        }
        if (filterCompleted.checked && isCompleted) {
            return true;
        }
        return false;
    });

    // Populate the dialog with the filtered tasks
    if (filteredTasks.length > 0) {
        filteredTasks.forEach(task => {
            taskListContainer.appendChild(renderFilteredTask(task, dialog));
        });
    } else {
        taskListContainer.innerHTML = '<p>No tasks match the current filter.</p>';
    }

    document.body.appendChild(dialog);

    closeButton.addEventListener('click', () => {
        dialog.close();
        dialog.remove();
    });

    dialog.showModal();
}

// --- Initial Data Sync ---
function syncTest() {
  const syncResponse = {
    syncToken: 0,
    updatedIds: [],
    updates: [
      { id: 't1', title: 'Buy groceries', isCompleted: false, parentId: null, sortOrder: 0 },
      { id: 't2', title: 'Prepare presentation', isCompleted: false, parentId: null, sortOrder: 1, dependencyIds: ["t1"] },
      { id: 't3', title: 'Call John (waiting for reply)', isCompleted: false, parentId: null, sortOrder: 2 },
      { id: 't4', title: 'Finish project report', isCompleted: true, parentId: null, sortOrder: 3 },
      { id: 'f1', title: 'Home Chores', parentId: null, sortOrder: 4 },
      { id: 'st1', title: 'Clean kitchen', isCompleted: false, parentId: 'f1', sortOrder: 0 },
      { id: 'st2', title: 'Do laundry', isCompleted: false, parentId: 'f1', sortOrder: 1, dependencyIds: ["st1"] },
      { id: 'st3', title: 'Mop floors', isCompleted: true, parentId: 'f1', sortOrder: 2 },
      { id: 'f2', title: 'Work Tasks', parentId: null, sortOrder: 5 },
      { id: 'wst1', title: 'Review code', isCompleted: false, parentId: 'f2', sortOrder: 0 },
      { id: 'wst2', title: 'Meeting with team', isCompleted: false, parentId: 'f2', sortOrder: 1, dependencyIds: ["wst1"] }
    ]
  };
 
  Task.mergeSyncResponse(syncResponse);
}

sync();

