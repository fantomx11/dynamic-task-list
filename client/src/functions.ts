/**
 * A simple debounce function to limit how often a function is called.
 * @param func The function to debounce.
 * @param delay The debounce delay in milliseconds.
 * @returns The debounced function.
 */
function debounce(func: (...args: any[]) => void, delay: number): (...args: any[]) => void {
  let timeout: number;
  return function (...args: any[]) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  };
}

/**
 * Performs a synchronization operation with the server for tasks.
 * @param {Function} [completedCallback] - An optional callback function to execute after sync completes.
 */
async function sync(completedCallback) {
  // Get dirty task data from the client-side Task model
  let tasks = Task.syncData;

  // Wrap the server-side 'syncTasks' function
  const googleSyncTasks = wrapGoogle("syncTasks"); // Changed from "sync" to "syncTasks"

  try {
    // Send client data to the server and receive updated data
    const serverTasksResponse = await googleSyncTasks(tasks); // Expecting 'tasks' property in response

    // Merge the server's response back into the client-side Task model
    Task.mergeSyncResponse(serverTasksResponse);

    console.log("Sync completed successfully.");
    if (completedCallback) completedCallback();
  } catch (error) {
    console.error("Sync failed:", error);
    // Optionally, handle UI feedback for sync failure
  }
}

// Debounced version of the sync function, triggered after 2 minutes of inactivity
const debouncedSync = debounce(async () => {
  console.log("Performing debounced sync (after 2 minutes of inactivity)...");
  await sync(); // This calls the global sync function
}, 120000); // 120,000 milliseconds = 2 minutes