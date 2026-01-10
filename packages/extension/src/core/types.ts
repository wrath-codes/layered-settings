export type { 
  Setting, 
  LayeredConfig, 
  KeyProvenance, 
  ProvenanceMap, 
  ExternalDelta, 
  ConflictData,
  ArraySegmentProvenance,
} from "@layered/core";

import type { KeyProvenance } from "@layered/core";

export type OwnedKeyChange = {
  key: string;
  newValue: unknown;
  provenance: KeyProvenance;
};

export type ConflictResolution = {
  key: string;
  chosenFile: string;
  allFiles: string[];
};

export interface ConfigProvider {
  readonly configDir: string;
  readonly configFilename: string;

  initialize(): Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;
}
