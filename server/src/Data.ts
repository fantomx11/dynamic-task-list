//#region Imports

import { ColumnInfo, MinimumData, SyncData, TaskData } from "@dynamic-task-list/shared";

//#endregion

//#region constants

const SPREADSHEET_ID = '1qrYw7aqCvNg5lSqsVZVbZpZrsk6s_IL7b903v2_bhFI';
const TASKS_SHEET_NAME = 'tasks';

//#endregion

//#region helper functions

function getSheetByName(sheetName: string): GoogleAppsScript.Spreadsheet.Sheet {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (!spreadsheet) {
    throw new Error(`Spreadsheet with ID ${SPREADSHEET_ID} not found.`);
  }
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found in spreadsheet.`);
  }
  return sheet;
}

function generateId(): string {
  return "id-" + Date.now().toString(16).padStart(12, "0") + "-" + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
}

function generateIds(updatedItems: any[] = []): {updatedItems: any[], idMap: Map<string, string>} {
  const idMap = new Map();

  updatedItems.filter(item => item.isNew).forEach(item => {
    const id = generateId();

    idMap.set(item.id, id);
    item.id = id;
  });

  return {updatedItems, idMap };
}

function getColumnInfo<T extends MinimumData>(sheet: GoogleAppsScript.Spreadsheet.Sheet): ColumnInfo<T>[] {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];

  const [headers, dataTypes] = sheet.getRange(1, 1, 2, lastCol).getValues();

  return headers.map((name, index) => {
    const dataType = dataTypes[index] === "" ? "string" : dataTypes[index];

    return { name, dataType };
  });
}

function getIndex<T extends MinimumData>(sheet: GoogleAppsScript.Spreadsheet.Sheet, columnInfo: ColumnInfo<T>[]): string[] {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return [];

  const idColumn = columnInfo.findIndex(col => col.name === "id");

  if (!idColumn) return [];

  return sheet.getRange(3, idColumn + 1, lastRow - 2, 1).getValues().map(row => row[0]);
}

const ToServerTransformers: Record<string, (val: any) => any> = {
  array: (val) => Array.isArray(val) ? JSON.stringify(val) : "[]",
  date: (val) => {
    if (val) {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
  }
}

/**
 * Converts a JavaScript object into a row array suitable for Google Sheets,
 * based on the provided column information.
 * Handles specific data type conversions like stringifying arrays.
 */
function convertToRow<T extends MinimumData>(obj: T, columnInfo: ColumnInfo<T>[]): any[] {
  return columnInfo.map(({ name, dataType }) => {
    const transformer = ToServerTransformers[dataType];
    const val = obj[name];

    if (transformer) {
      return transformer(val);
    } else {
      return val === undefined || val === null ? "" : val;
    }
  });
}

const FromServerTransformers: Record<string, (val: any) => any> = {
  string: (val) => String(val || ""),
  number: (val) => (val === "" || isNaN(Number(val))) ? null : Number(val),
  boolean: (val) => val === true || String(val).toLowerCase() === "true",
  array: (val) => { try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; } },
  date: (val) => { val = new Date(val); return isNaN(val.getTime()) ? null : val },
};

/**
 * Converts a raw row array from Google Sheets into a structured JavaScript object,
 * based on the provided column information.
 * Handles type conversions (number, boolean, array, date) and parsing stringified arrays.
 */
function convertFromRow<T extends MinimumData>(row: any[], columnInfo: ColumnInfo<T>[]): T {
  return columnInfo.reduce((obj, { name, dataType }, colIndex) => {
    const transformer = FromServerTransformers[dataType];

    if (transformer) {
      obj[name] = transformer(row[colIndex]);
    } else {
      obj[name] = row[colIndex];
    }

    return obj;
  }, {} as T);
}

/**
 * Synchronizes client-side task data with the server-side Google Sheet.
 * This function handles applying client updates to the sheet and returning server updates to the client.
 * @throws {Error} If there is a failure in loading or updating tasks.
 */
function mergeTasks(sheet: GoogleAppsScript.Spreadsheet.Sheet, columnInfo: ColumnInfo<TaskData>[], syncToken?: number, clientTasks: TaskData[] = []): SyncData<TaskData, "tasks"> {
  try {
    const index = getIndex(sheet, columnInfo);

    if (clientTasks.length > 0) {
      console.log("clientTasks length is greater than 0. Applying updates.");

      clientTasks.forEach(clientTask => {
        const serverRow = index.findIndex(id => id === clientTask.id);

        if (serverRow !== -1) {
          sheet.getRange(serverRow + 3, 1, 1, columnInfo.length).setValues([convertToRow(clientTask, columnInfo)]);
        } else {
          sheet.appendRow(convertToRow(clientTask, columnInfo));
          index.push(clientTask.id);
        }
      })
    }

    const serverTasks = sheet.getDataRange().getValues().slice(2).map(row => convertFromRow<TaskData>(row, columnInfo));
    const newSyncToken = Date.now();

    if (syncToken !== null && syncToken !== void 0) {
      return {
        syncToken: newSyncToken,
        tasks: serverTasks.filter(serverTask => (serverTask.syncVersion || 0) > syncToken)
      };
    } else {
      return {
        syncToken: newSyncToken,
        tasks: serverTasks.filter(task => !task.isDeleted)
      };
    }
  } catch (e) {
    throw new Error("Failed to sync tasks: " + e); // Changed error message for clarity
  }
}

function updateParentId(task: TaskData, idMap: Map<string, string>): TaskData {
  if(task.parentId) {
    const updatedParentId = idMap.get(task.parentId);
    
    if (updatedParentId !== void 0) {
      task.parentId = updatedParentId;
    }
  }

  return task;
}

function updateDependencyIds(task: TaskData, idMap: Map<string, string>): TaskData {
  task.dependencyIds = task.dependencyIds.map(id => {
    const updatedId = idMap.get(id);
    return (updatedId !== void 0) ? updatedId : id;
  });

  return task;
}

function updateIds(tasks: TaskData[], idMap: Map<string, string>): TaskData[] {
  tasks.forEach(task => {
    task = updateParentId(task, idMap);
    task = updateDependencyIds(task, idMap);
  });

  return tasks;
}

//#endregion

export function syncTasks({
  syncToken = 0,
  tasks = []
}: SyncData<TaskData, "tasks"> = {}): SyncData<TaskData, "tasks"> {
  const sheet = getSheetByName(TASKS_SHEET_NAME);
  const columnInfo = getColumnInfo<TaskData>(sheet);

  let idMap: Map<string, string>;

  ({updatedItems: tasks, idMap} = generateIds(tasks));

  tasks = updateIds(tasks, idMap);
  
  const returnData = mergeTasks(sheet, columnInfo, syncToken, tasks);

  return {
    ...returnData,
    updatedIds: <any>Object.fromEntries(idMap)
  };
}