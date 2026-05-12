//#region constants

/**
 * Global constant for the ID of your Google Sheet.
 */
const SPREADSHEET_ID = '1qrYw7aqCvNg5lSqsVZVbZpZrsk6s_IL7b903v2_bhFI';

/**
 * Global constant for the sheet name where tasks data will be stored.
 * @constant {string}
 */
const TASKS_SHEET_NAME = 'tasks';

//#endregion

//#region interfaces and types

type TypeName<T> =
  T extends string ? 'string' :
  T extends number ? 'number' :
  T extends boolean ? 'boolean' :
  T extends Date ? 'date' :
  T extends Array<any> ? 'array' :
  'object';

type ColumnInfo<T extends MinimumData, K extends keyof T = keyof T> = {
  name: K;
  dataType: TypeName<T[K]>;
}

type MinimumData = {
  id: string;
  deleted: boolean;
  syncVersion: number;
}
type SyncDataBase = {
  syncToken?: number;
  updatedIds?: Record<string, string>;
};

// Use a mapped type to handle the dynamic key
type DynamicPayload<T extends MinimumData, Name extends string> = {
  [K in Name]?: (T & { isNew?: boolean })[];
};

// Combine them into your final type
type SyncData<T extends MinimumData, Name extends string> = SyncDataBase & DynamicPayload<T, Name>;

interface Task extends MinimumData {
  id: string,
  title: string,
  parentId: string,
  dependencyIds: string[],
  isCompleted: string,
  sortOrder: number,
  syncVersion: number,
  deleted: boolean,
  delay: Date,
  completionDate: Date
}

//#endregion

//#region helper functions

/**
 * Retrieves a specific Google Sheet by its ID and name.
 * @throws {Error} If the spreadsheet with the global ID or the specified sheet is not found.
 */
function _getSheetByName(sheetName: string): GoogleAppsScript.Spreadsheet.Sheet {
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

/**
 * Generates a unique ID string. This ID is prefixed with "id-" and includes a timestamp
 * and a random hexadecimal component to ensure uniqueness.
 */
function _generateId(): string {
  return "id-" + Date.now().toString(16).padStart(12, "0") + "-" + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
}

/**
 * Updates the IDs of newly created items (those with temporary client-side IDs)
 * by generating new permanent server-side IDs and storing the mapping.
 */
function _updateIds(updatedItems: any[] = []): Map<string, string> {
  const updatedIds = new Map();

  updatedItems.filter(item => item.isNew).forEach(item => {
    const id = _generateId();

    updatedIds.set(item.id, id);
    item.id = id;
  });

  return updatedIds;
}

function _getColumnInfo<T extends MinimumData>(sheet: GoogleAppsScript.Spreadsheet.Sheet): ColumnInfo<T>[] {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];

  const [headers, dataTypes] = sheet.getRange(1, 1, 2, lastCol).getValues();

  return headers.map((name, index) => {
    const dataType = dataTypes[index] === "" ? "string" : dataTypes[index];

    return { name, dataType };
  });
}

function _getIndex<T extends MinimumData>(sheet: GoogleAppsScript.Spreadsheet.Sheet, columnInfo: ColumnInfo<T>[]): string[] {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return [];

  const idColumn = columnInfo.findIndex(col => col.name === "id");

  if (!idColumn) return [];

  return sheet.getRange(3, idColumn + 1, lastRow - 2, 1).getValues().map(row => row[0]);
}

/**
 * Converts a JavaScript object into a row array suitable for Google Sheets,
 * based on the provided column information.
 * Handles specific data type conversions like stringifying arrays.
 * @template T
 * @param {T} obj - The JavaScript object to convert.
 * @param {ColumnInfo[]} columnInfo - An array describing the columns (name and data type).
 * @returns {any[]} An array representing a row of data.
 */
function _convertToRow<T extends MinimumData>(obj: T, columnInfo: ColumnInfo<T>[]): any[] {
  return columnInfo.map(({ name, dataType }) => {
    let value: any = obj[name];

    switch (dataType) {
      case "array":
        // Ensure it's stringified for the sheet
        value = Array.isArray(value) ? JSON.stringify(value) : "[]";
        break;

      case "date":
        if (value) {
          const d = new Date(value);
          value = isNaN(d.getTime()) ? null : d;
        }
        break;
      default:
        value = value === undefined ? "" : value;
    }
    return value;
  });

}

/**
 * Converts a raw row array from Google Sheets into a structured JavaScript object,
 * based on the provided column information.
 * Handles type conversions (number, boolean, array, date) and parsing stringified arrays.
 */
function _convertFromRow<T extends MinimumData>(row: any[], columnInfo: ColumnInfo<T>[]): T {
  return columnInfo.reduce((obj, { name, dataType }, colIndex) => {
    let value = row[colIndex];

    switch (dataType) {
      case "string":
        break;

      case "number":
        value = (value === "" || isNaN(Number(value))) ? null : Number(value);
        break;

      case "boolean":
        value = value === true || String(value).toLowerCase() === "true";
        break;

      case "array":
        try {
          value = value ? JSON.parse(value) : [];
        } catch (e) {
          value = [];
        }
        if (!Array.isArray(value)) {
          value = [];
        }
        break;

      case "date":
        value = (value instanceof Date && !isNaN(value.getTime())) ? value : null;
        break;
      default:
        value = value === undefined ? "" : value;
    }

    obj[name] = value;

    return obj;
  }, <T>{});
}

/**
 * Synchronizes client-side task data with the server-side Google Sheet.
 * This function handles applying client updates to the sheet and returning server updates to the client.
 * @throws {Error} If there is a failure in loading or updating tasks.
 */
function _mergeTasks(sheet: GoogleAppsScript.Spreadsheet.Sheet, columnInfo: ColumnInfo<Task>[], syncToken?: number, clientTasks: Task[] = []): SyncData<Task, "tasks"> {
  try {
    const index = _getIndex(sheet, columnInfo);

    if (clientTasks.length > 0) {
      console.log("clientTasks length is greater than 0. Applying updates.");

      clientTasks.forEach(clientTask => {
        const serverRow = index.findIndex(id => id === clientTask.id);

        if (serverRow !== -1) {
          sheet.getRange(serverRow + 3, 1, 1, columnInfo.length).setValues([_convertToRow(clientTask, columnInfo)]);
        } else {
          sheet.appendRow(_convertToRow(clientTask, columnInfo));
          index.push(clientTask.id);
        }
      })
    }

    const serverTasks = sheet.getDataRange().getValues().slice(2).map(row => _convertFromRow<Task>(row, columnInfo));
    const newSyncToken = Date.now();

    if (syncToken !== null && syncToken !== void 0) {
      return {
        syncToken: newSyncToken,
        tasks: serverTasks.filter(serverTask => (serverTask.syncVersion || 0) > syncToken)
      };
    } else {
      return {
        syncToken: newSyncToken,
        tasks: serverTasks.filter(task => !task.deleted)
      };
    }
  } catch (e) {
    throw new Error("Failed to sync tasks: " + e); // Changed error message for clarity
  }
}

//#endregion

function syncTasks({
  syncToken = 0,
  tasks = []
}: SyncData<Task, "tasks"> = {}): SyncData<Task, "tasks"> {
  const sheet = _getSheetByName(TASKS_SHEET_NAME);
  const columnInfo = _getColumnInfo<Task>(sheet);

  const updatedIds = _updateIds(tasks);

  tasks.forEach(clientTask => {
    const updatedParentId = updatedIds.get(clientTask.parentId);

    if (updatedParentId !== void 0) {
      clientTask.parentId = updatedParentId;
    }

    [...updatedIds.keys()].forEach(updatedId => {
      const oldIdIndex = clientTask.dependencyIds.indexOf(updatedId);
      if (oldIdIndex !== -1) {
        clientTask.dependencyIds[oldIdIndex] = <string>updatedIds.get(updatedId);
      }
    });
  });

  const returnData = _mergeTasks(sheet, columnInfo, syncToken, tasks);

  return {
    ...returnData,
    updatedIds: Object.fromEntries(updatedIds)
  };
}