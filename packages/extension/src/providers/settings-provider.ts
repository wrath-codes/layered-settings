import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { diffArrays, diffObjects } from "@layered/core";
import { BackupManager } from "../core/backup-manager";
import { CaptureFileManager } from "../core/capture-file-manager";
import { ConfigMerger, deepEqual } from "../core/config-merger";
import { createConflictDiagnostics } from "../core/conflict-manager";
import { FileWatcherManager, SettingsFileWatcher } from "../core/file-watcher";
import type {
  ArraySegmentProvenance,
  ConfigProvider,
  ExternalDelta,
  KeyProvenance,
  LayeredConfig,
  OwnedKeyChange,
  ProvenanceMap,
  Setting,
} from "../core/types";
import { log } from "../utils/logger";

export type StatusKind = "ok" | "no-config" | "refreshing";

export class SettingsProvider implements ConfigProvider {
  readonly configDir: string;
  readonly configFilename = "config.json";

  private folderPath: string;
  private merger: ConfigMerger;
  private captureFileManager: CaptureFileManager;
  private backupManager: BackupManager | null = null;
  private fileWatcher: FileWatcherManager;
  private settingsWatcher: SettingsFileWatcher;
  private isApplyingSettings = false;
  private ownedKeys: Set<string> = new Set();
  private previousOwnedKeys: Set<string> = new Set();
  private provenance: ProvenanceMap = new Map();
  private externalBaseline: Setting = {};
  private statusKind: StatusKind = "no-config";
  private previousLayeredJsonSettings: Record<string, unknown> = {};

  constructor(
    private readonly folder: vscode.WorkspaceFolder,
    private readonly onStatusChange: (provider: SettingsProvider) => void,
    storageUri?: vscode.Uri
  ) {
    this.folderPath = folder.uri.fsPath;
    this.configDir = path.join(
      this.folderPath,
      ".vscode",
      "layered-settings",
      "settings"
    );

    this.merger = new ConfigMerger(this.configDir);
    this.captureFileManager = new CaptureFileManager(this.configDir);

    if (storageUri) {
      this.backupManager = new BackupManager(storageUri);
    }

    this.fileWatcher = new FileWatcherManager(
      path.join(this.configDir, "**/*.json"),
      () => this.rebuild()
    );

    this.settingsWatcher = new SettingsFileWatcher(
      path.join(this.folderPath, ".vscode", "settings.json"),
      () => this.detectExternalChanges(),
      () => this.isApplyingSettings
    );
  }

  getFolderName(): string {
    return this.folder.name;
  }

  getFolderUri(): vscode.Uri {
    return this.folder.uri;
  }

  getSettingsCount(): number {
    return this.ownedKeys.size;
  }

  getStatusKind(): StatusKind {
    return this.statusKind;
  }

  async initialize(): Promise<void> {
    log("Initializing SettingsProvider");
    this.fileWatcher.setupDirectoryWatcher();
    this.settingsWatcher.setup();
    await this.rebuild();
    log(
      `Initialization complete. Owned keys: ${this.ownedKeys.size}, Provenance: ${this.provenance.size}`
    );
  }

  async refresh(): Promise<void> {
    await this.rebuild();
  }

  dispose(): void {
    this.fileWatcher.dispose();
    this.settingsWatcher.dispose();
  }

  private async rebuild(): Promise<void> {
    this.statusKind = "refreshing";
    this.onStatusChange(this);

    // Backup layered.json before rebuild (if it exists)
    if (this.backupManager) {
      await this.backupManager.backupLayeredJson(this.configDir);
    }

    await this.merger.mergeFromWorkspaceFolder(this.folderPath);

    const settings = this.merger.getSettings();

    if (Object.keys(settings).length === 0) {
      await this.cleanupPreviousSettings();
      this.statusKind = "no-config";
      this.onStatusChange(this);
      return;
    }

    // Check for layered.json deletion
    if (this.backupManager) {
      const wasDeleted = this.backupManager.detectLayeredJsonDeletion(
        this.configDir,
        this.previousLayeredJsonSettings
      );
      if (wasDeleted) {
        this.backupManager.warnLayeredJsonDeleted();
      }
    }

    // Update previousLayeredJsonSettings for next rebuild
    this.previousLayeredJsonSettings =
      this.captureFileManager.getLayeredJsonSettings();

    this.previousOwnedKeys = this.ownedKeys;
    this.provenance = this.merger.getProvenance();
    this.ownedKeys = this.merger.getOwnedKeys();

    const conflicts = this.merger.getConflictedKeys();
    await createConflictDiagnostics(conflicts, this.provenance, this.folderPath);

    await this.applySettings();

    const extendedFiles = [...this.merger.getExtendedFiles()];
    const inheritedConfigs = this.merger.getInheritedConfigPaths();
    this.fileWatcher.setupFileWatchers([...extendedFiles, ...inheritedConfigs]);

    this.statusKind = "ok";
    this.onStatusChange(this);
  }

  private async cleanupPreviousSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration(undefined, this.folder.uri);

    for (const key of this.previousOwnedKeys) {
      try {
        await config.update(key, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      } catch (error) {
        console.error(`Failed to remove setting "${key}":`, error);
      }
    }

    this.ownedKeys = new Set();
    this.previousOwnedKeys = new Set();
    this.provenance = new Map();
    this.externalBaseline = {};

    await createConflictDiagnostics([], new Map(), this.folderPath);
  }

  private async applySettings(): Promise<void> {
    this.isApplyingSettings = true;

    try {
      const config = vscode.workspace.getConfiguration(undefined, this.folder.uri);
      const settings = this.merger.getSettings();
      const newKeys = new Set(Object.keys(settings));

      // Remove keys that were previously owned but are no longer present
      for (const key of this.previousOwnedKeys) {
        if (!newKeys.has(key)) {
          try {
            await config.update(key, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
            log(`Removed deleted setting: "${key}"`);
          } catch (error) {
            console.error(`Failed to remove setting "${key}":`, error);
          }
        }
      }

      // Apply current settings
      for (const [key, value] of Object.entries(settings)) {
        try {
          await config.update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
        } catch (error) {
          console.error(`Failed to update setting "${key}":`, error);
        }
      }

      await this.updateExternalBaseline();
    } finally {
      this.isApplyingSettings = false;
    }
  }

  private async updateExternalBaseline(): Promise<void> {
    const workspaceSettings = this.getWorkspaceSettingsObject();
    this.externalBaseline = this.stripOwnedKeys(workspaceSettings);
  }

  private getWorkspaceSettingsObject(): Setting {
    const settingsPath = path.join(this.folderPath, ".vscode", "settings.json");
    try {
      const content = fs.readFileSync(settingsPath, "utf8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private stripOwnedKeys(settings: Setting): Setting {
    return Object.fromEntries(
      Object.entries(settings).filter(([key]) => !this.ownedKeys.has(key))
    );
  }

  private async detectExternalChanges(): Promise<void> {
    log("detectExternalChanges called");

    if (this.ownedKeys.size === 0) {
      log("No owned keys, skipping");
      return;
    }

    const workspaceSettings = this.getWorkspaceSettingsObject();

    // Process array changes first (they have special segment-based handling)
    const arrayChanges = this.detectArrayChanges(workspaceSettings);
    if (arrayChanges.length > 0) {
      log(
        `Processing array changes: ${arrayChanges.map((c) => c.key).join(", ")}`
      );
      for (const change of arrayChanges) {
        await this.handleArrayChange(change.key, change.newArray, change.provenance);
      }
      return;
    }

    // Process scalar owned key changes
    const ownedChanges = this.detectOwnedKeyChanges(workspaceSettings);
    if (ownedChanges.length > 0) {
      log(
        `Processing owned changes: ${ownedChanges.map((c) => c.key).join(", ")}`
      );
      await this.handleOwnedKeyChanges(ownedChanges);
      return;
    }

    const externalNow = this.stripOwnedKeys(workspaceSettings);
    const delta = diffObjects(this.externalBaseline, externalNow);

    if (
      Object.keys(delta.added).length === 0 &&
      Object.keys(delta.changed).length === 0 &&
      delta.removed.length === 0
    ) {
      return;
    }

    await this.handleExternalDelta(delta, externalNow);
  }

  private detectOwnedKeyChanges(
    workspaceSettings: Setting
  ): OwnedKeyChange[] {
    return [...this.provenance.entries()]
      .filter(([key]) => key in workspaceSettings)
      .filter(([key, prov]) => {
        const currentValue = workspaceSettings[key];
        // Skip arrays - ambiguous which file to write to
        if (Array.isArray(currentValue) || Array.isArray(prov.winnerValue)) {
          return false;
        }
        return !deepEqual(currentValue, prov.winnerValue);
      })
      .map(([key, prov]) => ({
        key,
        newValue: workspaceSettings[key],
        provenance: prov,
      }));
  }

  private detectArrayChanges(
    workspaceSettings: Setting
  ): Array<{ key: string; newArray: unknown[]; provenance: KeyProvenance }> {
    return [...this.provenance.entries()]
      .filter(([key]) => key in workspaceSettings)
      .filter(([, prov]) => Array.isArray(prov.winnerValue))
      .filter(([key, prov]) => {
        const currentValue = workspaceSettings[key];
        if (!Array.isArray(currentValue)) return false;
        return !deepEqual(currentValue, prov.winnerValue);
      })
      .map(([key, prov]) => ({
        key,
        newArray: workspaceSettings[key] as unknown[],
        provenance: prov,
      }));
  }

  private findSegmentForIndex(
    segments: ArraySegmentProvenance[],
    index: number
  ): ArraySegmentProvenance | null {
    return (
      segments.find(
        (seg) => index >= seg.start && index < seg.start + seg.length
      ) ?? null
    );
  }

  private isParentOwned(sourceFile: string): boolean {
    const relative = path.relative(this.folderPath, sourceFile);
    return relative.startsWith("..") || path.isAbsolute(relative);
  }

  private findAllOccurrences(
    value: unknown,
    mergedArray: unknown[],
    segments: ArraySegmentProvenance[]
  ): Array<{ index: number; segment: ArraySegmentProvenance }> {
    return mergedArray
      .map((el, idx) => ({ el, idx }))
      .filter(({ el }) => deepEqual(el, value))
      .map(({ idx }) => {
        const segment = this.findSegmentForIndex(segments, idx);
        return segment ? { index: idx, segment } : null;
      })
      .filter((item): item is { index: number; segment: ArraySegmentProvenance } => item !== null);
  }

  private async handleArrayChange(
    key: string,
    newArray: unknown[],
    provenance: KeyProvenance
  ): Promise<void> {
    const prevArray = provenance.winnerValue as unknown[];
    const segments = provenance.arraySegments ?? [];

    log(`handleArrayChange: key="${key}", segments=${segments.length}`);

    const diff = diffArrays(prevArray, newArray);

    log(`handleArrayChange: diff kind="${diff.kind}", removed=${JSON.stringify(diff.removed)}, added=${JSON.stringify(diff.added)}`);

    if (diff.kind === "none") {
      return;
    }

    if (diff.kind === "complex") {
      log(`Array "${key}" is too large for diff-based writeback, skipping`);
      return;
    }

    // Transaction check: if ANY removed value exists only in parent files, abort ALL changes
    for (const removedValue of diff.removed) {
      const occurrences = this.findAllOccurrences(removedValue, prevArray, segments);
      const hasNonParentOccurrence = occurrences.some(
        ({ segment }) => !this.isParentOwned(segment.sourceFile)
      );

      if (!hasNonParentOccurrence && occurrences.length > 0) {
        // All occurrences are in parent files - abort entire transaction
        log(`handleArrayChange: BLOCKING removal of "${removedValue}" - parent-owned`);
        await this.handleBlockedRemoval(key, removedValue, occurrences[0].segment.sourceFile);
        await this.revertArrayInSettings(key, prevArray);
        return;
      }
    }

    // Process additions (all go to layered.json)
    if (diff.added.length > 0) {
      await this.handleArrayAdditions(key, diff.added);
    }

    // Process removals (to their respective source files, preferring winner)
    if (diff.removed.length > 0) {
      await this.handleArrayRemovals(key, diff.removed, prevArray, segments, provenance.winner);
    }

    await this.updateExternalBaseline();
  }

  private async handleArrayAdditions(
    key: string,
    added: unknown[]
  ): Promise<void> {
    const layeredJsonExisted = this.captureFileManager.layeredJsonExists();

    await this.captureFileManager.appendToArraySetting(key, added);
    await this.ensureFileInConfig("layered.json");

    // Auto-add to gitignore on first creation
    if (!layeredJsonExisted && this.backupManager) {
      await this.backupManager.ensureGitignore(this.folderPath);
    }

    log(`Captured ${added.length} new element(s) for "${key}" to layered.json`);
  }

  private async handleArrayRemovals(
    key: string,
    removed: unknown[],
    mergedArray: unknown[],
    segments: ArraySegmentProvenance[],
    winnerFile: string
  ): Promise<void> {
    // Group removals by source file (prefer winner/child file for duplicates)
    const removalsByFile = new Map<string, unknown[]>();

    for (const value of removed) {
      const occurrences = this.findAllOccurrences(value, mergedArray, segments);
      
      // Prefer winner file if it has this value, otherwise use first non-parent
      const winnerOccurrence = occurrences.find(
        ({ segment }) => segment.sourceFile === winnerFile
      );
      const nonParentOccurrence = occurrences.find(
        ({ segment }) => !this.isParentOwned(segment.sourceFile)
      );
      const targetOccurrence = winnerOccurrence ?? nonParentOccurrence;

      if (targetOccurrence) {
        const file = targetOccurrence.segment.sourceFile;
        const existing = removalsByFile.get(file) ?? [];
        removalsByFile.set(file, [...existing, value]);
      }
    }

    // Apply removals to each file
    for (const [filePath, values] of removalsByFile) {
      for (const value of values) {
        await this.removeArrayElementFromFile(filePath, key, value);
      }
    }
  }

  private async removeArrayElementFromFile(
    filePath: string,
    key: string,
    elementValue: unknown
  ): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const config: LayeredConfig = JSON.parse(content);

      if (!config.settings || !Array.isArray(config.settings[key])) {
        return;
      }

      const arr = config.settings[key] as unknown[];
      const indexToRemove = arr.findIndex((el) => deepEqual(el, elementValue));

      if (indexToRemove === -1) {
        return;
      }

      config.settings[key] = [
        ...arr.slice(0, indexToRemove),
        ...arr.slice(indexToRemove + 1),
      ];

      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
      log(`Removed element from "${key}" in ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`Failed to remove element from ${filePath}:`, error);
    }
  }

  private async handleBlockedRemoval(
    key: string,
    elementValue: unknown,
    sourceFile: string
  ): Promise<void> {
    const displayValue =
      typeof elementValue === "string"
        ? elementValue
        : JSON.stringify(elementValue);

    // Don't await - let the message show but don't block the revert
    vscode.window.showWarningMessage(
      `Cannot remove "${displayValue}" - defined in root config`,
      "Open Source File"
    ).then(async (action) => {
      if (action === "Open Source File") {
        const doc = await vscode.workspace.openTextDocument(sourceFile);
        await vscode.window.showTextDocument(doc);
      }
    });

    log(`Blocked removal of "${displayValue}" from "${key}" (owned by ${path.basename(sourceFile)})`);
  }

  private async revertArrayInSettings(
    key: string,
    originalArray: unknown[]
  ): Promise<void> {
    this.isApplyingSettings = true;

    try {
      const config = vscode.workspace.getConfiguration(undefined, this.folder.uri);
      await config.update(key, originalArray, vscode.ConfigurationTarget.WorkspaceFolder);
      log(`Reverted "${key}" to original array`);
    } finally {
      this.isApplyingSettings = false;
    }
  }

  private async handleOwnedKeyChanges(
    changes: OwnedKeyChange[]
  ): Promise<void> {
    for (const change of changes) {
      const { key, newValue, provenance } = change;

      if (provenance.overrides.length > 0) {
        continue;
      }

      await this.updateSourceFile(provenance.winner, key, newValue);
    }

    await this.updateExternalBaseline();
  }

  private async handleExternalDelta(
    delta: ExternalDelta,
    externalNow: Setting
  ): Promise<void> {
    const addedKeys = Object.keys(delta.added);
    const changedKeys = Object.keys(delta.changed);

    if (addedKeys.length === 0 && changedKeys.length === 0) {
      this.externalBaseline = externalNow;
      return;
    }

    const allKeys = [...addedKeys, ...changedKeys];
    const targetFile = await this.showFileQuickPick(allKeys);

    if (!targetFile) {
      this.externalBaseline = externalNow;
      return;
    }

    await this.captureToFile(targetFile, { ...delta.added, ...delta.changed });
    this.externalBaseline = externalNow;
  }

  private async showFileQuickPick(
    settingKeys: string[]
  ): Promise<string | undefined> {
    const existingFiles = this.getExistingConfigFiles();

    const items: vscode.QuickPickItem[] = [
      {
        label: "$(add) Create new file...",
        description: "Create a new layered config file",
        alwaysShow: true,
      },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      ...existingFiles.map((file) => ({
        label: `$(file) ${file}`,
        description: path.join(".vscode", "layered-settings", "settings", file),
      })),
    ];

    const keysPreview =
      settingKeys.length <= 3
        ? settingKeys.join(", ")
        : `${settingKeys.slice(0, 3).join(", ")}... (+${settingKeys.length - 3} more)`;

    const picked = await vscode.window.showQuickPick(items, {
      title: "Capture External Settings",
      placeHolder: `Select destination for: ${keysPreview}`,
      ignoreFocusOut: true,
    });

    if (!picked) return undefined;

    if (picked.label.includes("Create new file")) {
      const newFileName = await vscode.window.showInputBox({
        prompt: "Enter new config file name",
        placeHolder: "my-settings.json",
        validateInput: (value) => {
          if (!value) return "File name is required";
          if (!value.endsWith(".json")) return "File must end with .json";
          if (value === "config.json") return "Cannot use config.json";
          if (this.captureFileManager.isReservedName(value)) {
            return "layered.json is reserved for auto-captured settings";
          }
          if (existingFiles.includes(value)) return "File already exists";
          if (!/^[\w\-\.]+$/.test(value)) return "Invalid file name";
          return undefined;
        },
      });

      if (!newFileName) return undefined;

      const newFilePath = path.join(this.configDir, newFileName);
      const template: LayeredConfig = { settings: {} };
      fs.writeFileSync(newFilePath, JSON.stringify(template, null, 2));

      return newFileName;
    }

    return picked.label.replace("$(file) ", "");
  }

  private getExistingConfigFiles(): string[] {
    if (!fs.existsSync(this.configDir)) return [];

    return fs
      .readdirSync(this.configDir)
      .filter(
        (file) =>
          file.endsWith(".json") && file !== "config.json" && file !== ".json"
      );
  }

  private async captureToFile(
    fileName: string,
    newSettings: Setting
  ): Promise<void> {
    const filePath = path.join(this.configDir, fileName);

    let current: LayeredConfig = { settings: {} };
    try {
      const content = fs.readFileSync(filePath, "utf8");
      current = JSON.parse(content);
    } catch {
      /* file may not exist */
    }

    const updatedSettings = { ...(current.settings || {}), ...newSettings };
    const updated: LayeredConfig = { ...current, settings: updatedSettings };

    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));

    await this.ensureFileInConfig(fileName);
    await this.refresh();

    vscode.window.showInformationMessage(
      `Captured ${Object.keys(newSettings).length} setting(s) to ${fileName}`
    );
  }

  private async ensureFileInConfig(fileName: string): Promise<void> {
    const configPath = path.join(this.configDir, this.configFilename);
    if (!fs.existsSync(configPath)) return;

    try {
      const content = fs.readFileSync(configPath, "utf8");
      const config: LayeredConfig = JSON.parse(content);

      const extendsList = Array.isArray(config.extends)
        ? config.extends
        : config.extends
          ? [config.extends]
          : [];

      if (!extendsList.includes(fileName)) {
        extendsList.push(fileName);
        config.extends = extendsList;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      }
    } catch (error) {
      console.error(`Failed to update config.json with ${fileName}:`, error);
    }
  }

  private async updateSourceFile(
    filePath: string,
    key: string,
    value: unknown
  ): Promise<void> {
    if (value === undefined) {
      log(`Skipping update for "${key}" - value is undefined`);
      return;
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const config: LayeredConfig = JSON.parse(content);

      if (!config.settings) {
        config.settings = {};
      }

      config.settings[key] = value;
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

      log(`Updated "${key}" in ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`Failed to update ${filePath}:`, error);
      vscode.window.showWarningMessage(
        `Could not update ${path.basename(filePath)}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  async resolveConflictAction(
    key: string,
    chosenFile: string,
    allFiles: string[]
  ): Promise<void> {
    const filesToRemoveFrom = allFiles.filter((f) => f !== chosenFile);

    for (const file of filesToRemoveFrom) {
      await this.removeKeyFromFile(key, file);
    }

    log(`Resolved conflict for "${key}" - kept in ${chosenFile}`);
    await this.refresh();
  }

  private async removeKeyFromFile(
    key: string,
    filePath: string
  ): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const config: LayeredConfig = JSON.parse(content);

      if (config.settings && key in config.settings) {
        delete config.settings[key];
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
        log(`Removed "${key}" from ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.error(`Failed to remove key from ${filePath}:`, error);
    }
  }
}
