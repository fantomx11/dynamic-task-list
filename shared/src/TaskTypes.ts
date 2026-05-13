export type TypeName<T> =
  T extends string ? 'string' :
  T extends number ? 'number' :
  T extends boolean ? 'boolean' :
  T extends Date ? 'date' :
  T extends Array<any> ? 'array' :
  'object';

export type ColumnInfo<T extends MinimumData, K extends keyof T = keyof T> = {
  name: K;
  dataType: TypeName<T[K]>;
}

export type MinimumData = {
  id: string;
  deleted: boolean;
  syncVersion: number;
}

export type SyncDataBase = {
  syncToken?: number;
  updatedIds?: Record<string, string>;
};

export type DynamicPayload<T extends MinimumData, Name extends string> = {
  [K in Name]?: (T & { isNew?: boolean })[];
};

export type SyncData<T extends MinimumData, Name extends string> = SyncDataBase & DynamicPayload<T, Name>;

export interface Task extends MinimumData {
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