export type Setting = Record<string, unknown>;

export type LayeredConfig = {
  root?: boolean;
  extends?: string | string[];
  settings?: Setting;
};

export type KeyProvenance = {
  winner: string;
  winnerValue: unknown;
  overrides: Array<{ file: string; value: unknown }>;
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

export interface ConfigProvider {
  readonly configDir: string;
  readonly configFilename: string;

  initialize(): Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;
}
