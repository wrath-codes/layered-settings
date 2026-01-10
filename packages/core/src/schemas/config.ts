export type Setting = Record<string, unknown>;

export type LayeredConfig = {
  root?: boolean;
  extends?: string | string[];
  settings?: Setting;
};

export type ArraySegmentProvenance = {
  sourceFile: string; // absolute, normalized path (forward slashes)
  start: number; // starting index in merged array
  length: number; // number of contiguous elements from this file
};

export type KeyProvenance = {
  winner: string;
  winnerValue: unknown;
  overrides: Array<{ file: string; value: unknown }>;
  arraySegments?: ArraySegmentProvenance[]; // Only for array-type settings
};

export type ProvenanceMap = Map<string, KeyProvenance>;

export type ExternalDelta = {
  added: Setting;
  changed: Setting;
  removed: string[];
};

export type ConflictData = {
  key: string;
  allFiles: string[];
};
