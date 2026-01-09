export type { 
  Setting, 
  LayeredConfig, 
  KeyProvenance, 
  ProvenanceMap, 
  ExternalDelta, 
  ConflictData 
} from "@layered/core";

export interface ConfigProvider {
  readonly configDir: string;
  readonly configFilename: string;

  initialize(): Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;
}
