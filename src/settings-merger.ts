import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | null = null;
let diagnosticCollection: vscode.DiagnosticCollection | null = null;

export function setOutputChannel(channel: vscode.OutputChannel): void {
  outputChannel = channel;
}

export function setDiagnosticCollection(
  collection: vscode.DiagnosticCollection,
): void {
  diagnosticCollection = collection;
}

function log(message: string): void {
  outputChannel?.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}

type Setting = Record<string, unknown>;

type LayeredConfig = {
  root?: boolean;
  extends?: string | string[];
  settings?: Setting;
};

type WatchedFile = {
  path: string;
  watcher: vscode.FileSystemWatcher;
};

type ExternalDelta = {
  added: Setting;
  changed: Setting;
  removed: string[];
};

type KeyProvenance = {
  winner: string;
  winnerValue: unknown;
  overrides: Array<{ file: string; value: unknown }>;
};

type ProvenanceMap = Map<string, KeyProvenance>;

export class SettingsMerger {
  private finalSettings: Setting = {};
  private configFiles: string[] = [];
  private extendedFiles: Set<string> = new Set();
  private folderPath: string;
  private watchers: WatchedFile[] = [];
  private directoryWatcher: vscode.FileSystemWatcher | null = null;
  private settingsWatcher: vscode.FileSystemWatcher | null = null;
  private configChangeDisposable: vscode.Disposable | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private externalDebounceTimer: NodeJS.Timeout | null = null;
  private statusBarItem: vscode.StatusBarItem;
  private resolving: Set<string> = new Set();
  private isApplyingSettings = false;
  private ownedKeys: Set<string> = new Set();
  private externalBaseline: Setting = {};
  private provenance: ProvenanceMap = new Map();
  private readonly DEBOUNCE_MS = 300;
  private readonly CONFIG_DIR = 'layered-settings';
  private readonly CONFIG_FILENAME = 'config.json';
  private readonly EXTERNAL_FILENAME = 'external.json';

  constructor(folderPath: string, statusBarItem: vscode.StatusBarItem) {
    this.folderPath = folderPath;
    this.statusBarItem = statusBarItem;
  }

  async initialize(): Promise<void> {
    log('Initializing SettingsMerger');
    this.setupDirectoryWatcher();
    this.setupSettingsWatcher();
    await this.rebuildSettings();
    this.setupWatchers();
    log(
      `Initialization complete. Owned keys: ${this.ownedKeys.size}, Provenance: ${this.provenance.size}`,
    );
  }

  dispose(): void {
    this.clearWatchers();
    if (this.directoryWatcher) {
      this.directoryWatcher.dispose();
    }
    if (this.settingsWatcher) {
      this.settingsWatcher.dispose();
    }
    if (this.configChangeDisposable) {
      this.configChangeDisposable.dispose();
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.externalDebounceTimer) {
      clearTimeout(this.externalDebounceTimer);
    }
  }

  private setupDirectoryWatcher(): void {
    const configDir = path.join(
      this.folderPath,
      '.vscode',
      this.CONFIG_DIR,
      '**/*.json',
    );
    this.directoryWatcher = vscode.workspace.createFileSystemWatcher(configDir);

    this.directoryWatcher.onDidCreate(() => this.debouncedRebuild());
    this.directoryWatcher.onDidDelete(() => this.debouncedRebuild());
  }

  private setupSettingsWatcher(): void {
    const settingsPath = path.join(this.folderPath, '.vscode', 'settings.json');
    log(`Setting up settings watcher for: ${settingsPath}`);
    this.settingsWatcher =
      vscode.workspace.createFileSystemWatcher(settingsPath);

    this.settingsWatcher.onDidChange(() => {
      log('settings.json changed (file watcher)');
      this.debouncedExternalCheck();
    });
    this.settingsWatcher.onDidCreate(() => {
      log('settings.json created (file watcher)');
      this.debouncedExternalCheck();
    });

    this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration(
      () => {
        log('Configuration changed (VSCode API)');
        this.debouncedExternalCheck();
      },
    );
  }

  private debouncedExternalCheck(): void {
    log(
      `debouncedExternalCheck called, isApplyingSettings: ${this.isApplyingSettings}`,
    );
    if (this.isApplyingSettings) {
      log('Skipping - currently applying settings');
      return;
    }

    if (this.externalDebounceTimer) {
      clearTimeout(this.externalDebounceTimer);
    }

    this.externalDebounceTimer = setTimeout(async () => {
      log('Debounce timer fired, calling detectExternalChanges');
      await this.detectExternalChanges();
    }, this.DEBOUNCE_MS);
  }

  private getConfigDir(): string {
    return path.join(this.folderPath, '.vscode', this.CONFIG_DIR);
  }

  private getConfigPath(): string {
    return path.join(this.getConfigDir(), this.CONFIG_FILENAME);
  }

  async refresh(): Promise<void> {
    await this.rebuildSettings();
    this.setupWatchers();
  }

  private clearWatchers(): void {
    for (const watched of this.watchers) {
      watched.watcher.dispose();
    }
    this.watchers = [];
  }

  private setupWatchers(): void {
    this.clearWatchers();

    const allFiles = [...this.configFiles, ...this.extendedFiles];

    for (const filePath of allFiles) {
      if (!fs.existsSync(filePath)) continue;

      const watcher = vscode.workspace.createFileSystemWatcher(filePath);

      watcher.onDidChange(() => this.debouncedRebuild());
      watcher.onDidDelete(() => this.debouncedRebuild());

      this.watchers.push({ path: filePath, watcher });
    }

    this.updateStatusBar(`$(check) ${this.watchers.length} files watched`);
  }

  private debouncedRebuild(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.updateStatusBar('$(sync~spin) Syncing...');

    this.debounceTimer = setTimeout(async () => {
      await this.rebuildSettings();
      this.setupWatchers();
    }, this.DEBOUNCE_MS);
  }

  private updateStatusBar(text: string): void {
    this.statusBarItem.text = text;
    this.statusBarItem.show();
  }

  private async rebuildSettings(): Promise<void> {
    this.configFiles = [];
    this.extendedFiles = new Set();
    this.finalSettings = {};
    this.resolving = new Set();
    this.provenance = new Map();

    const configPath = this.getConfigPath();

    if (!fs.existsSync(configPath)) {
      await this.findUpConfigs(path.dirname(this.folderPath));

      if (Object.keys(this.finalSettings).length === 0) {
        this.updateStatusBar('$(info) No config found');
        return;
      }

      const answer = await vscode.window.showInformationMessage(
        'Layered Settings found in parent folders. Apply them?',
        'Yes',
        'No',
      );

      if (answer === 'Yes') {
        await this.applySettings();
      }
      return;
    }

    await this.findUpConfigs(this.folderPath);
    await this.resolveConflicts();
    await this.applySettings();
  }

  private async resolveConflicts(): Promise<void> {
    const conflicts = this.getConflictedKeys();
    diagnosticCollection?.clear();

    if (conflicts.length === 0) {
      log('No conflicts detected');
      return;
    }

    log(`Found ${conflicts.length} conflict(s): ${conflicts.join(', ')}`);
    await this.createConflictDiagnostics(conflicts);
  }

  private getConflictedKeys(): string[] {
    const conflicted: string[] = [];
    for (const [key, provenance] of this.provenance.entries()) {
      if (provenance.overrides.length > 0) {
        conflicted.push(key);
      }
    }
    return conflicted;
  }

  private async createConflictDiagnostics(conflicts: string[]): Promise<void> {
    const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();

    for (const key of conflicts) {
      const provenance = this.provenance.get(key);
      if (!provenance) continue;

      const allFiles = [
        provenance.winner,
        ...provenance.overrides.map((o) => o.file),
      ];

      for (const fileName of allFiles) {
        const filePath = path.join(this.getConfigDir(), fileName);
        const position = await this.findKeyPosition(filePath, key);

        const diagnostic = new vscode.Diagnostic(
          position,
          `"${key}" is also defined in: ${allFiles.filter((f) => f !== fileName).join(', ')}`,
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = 'layered-settings';
        (diagnostic as { data?: { key: string; allFiles: string[] } }).data = {
          key,
          allFiles,
        };

        const uri = vscode.Uri.file(filePath);
        const existing = diagnosticsByFile.get(filePath) || [];
        existing.push(diagnostic);
        diagnosticsByFile.set(filePath, existing);
      }
    }

    for (const [filePath, diagnostics] of diagnosticsByFile) {
      diagnosticCollection?.set(vscode.Uri.file(filePath), diagnostics);
    }
  }

  private async findKeyPosition(
    filePath: string,
    key: string,
  ): Promise<vscode.Range> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const keyPattern = new RegExp(`"${key}"\\s*:`);
        const match = line.match(keyPattern);
        if (match && match.index !== undefined) {
          return new vscode.Range(
            i,
            match.index,
            i,
            match.index + key.length + 2,
          );
        }
      }
    } catch {
      // File read error
    }

    return new vscode.Range(0, 0, 0, 0);
  }

  async resolveConflictAction(
    key: string,
    chosenFile: string,
    allFiles: string[],
  ): Promise<void> {
    const filesToRemoveFrom = allFiles.filter((f) => f !== chosenFile);

    for (const file of filesToRemoveFrom) {
      await this.removeKeyFromFile(key, file);
    }

    const provenance = this.provenance.get(key);
    if (provenance) {
      const chosenEntry =
        provenance.winner === chosenFile
          ? { value: provenance.winnerValue }
          : provenance.overrides.find((o) => o.file === chosenFile);

      this.provenance.set(key, {
        winner: chosenFile,
        winnerValue: chosenEntry?.value,
        overrides: [],
      });
    }

    log(`Resolved conflict for "${key}" - kept in ${chosenFile}`);
    await this.refresh();
  }

  private async applySettings(): Promise<void> {
    this.isApplyingSettings = true;

    try {
      const config = vscode.workspace.getConfiguration();
      this.ownedKeys = new Set(Object.keys(this.finalSettings));

      for (const [key, value] of Object.entries(this.finalSettings)) {
        try {
          await config.update(key, value, vscode.ConfigurationTarget.Workspace);
        } catch (error) {
          console.error(`Failed to update setting "${key}":`, error);
        }
      }

      await this.updateExternalBaseline();
      this.updateStatusBar(
        `$(check) ${Object.keys(this.finalSettings).length} settings applied`,
      );
    } finally {
      this.isApplyingSettings = false;
    }
  }

  private async updateExternalBaseline(): Promise<void> {
    const workspaceSettings = await this.getWorkspaceSettingsObject();
    this.externalBaseline = this.stripOwnedKeys(workspaceSettings);
  }

  private async getWorkspaceSettingsObject(): Promise<Setting> {
    const settingsPath = path.join(this.folderPath, '.vscode', 'settings.json');
    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private stripOwnedKeys(settings: Setting): Setting {
    const result: Setting = {};
    for (const [key, value] of Object.entries(settings)) {
      if (!this.ownedKeys.has(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  private async detectExternalChanges(): Promise<void> {
    log('detectExternalChanges called');
    log(`ownedKeys: ${[...this.ownedKeys].join(', ')}`);
    log(`provenance size: ${this.provenance.size}`);

    if (this.ownedKeys.size === 0) {
      log('No owned keys, skipping');
      return;
    }

    const workspaceSettings = await this.getWorkspaceSettingsObject();
    log(
      `workspace settings keys: ${Object.keys(workspaceSettings).join(', ')}`,
    );

    const ownedChanges = this.detectOwnedKeyChanges(workspaceSettings);
    log(`ownedChanges count: ${ownedChanges.length}`);
    if (ownedChanges.length > 0) {
      log(
        `Processing owned changes: ${ownedChanges.map((c) => c.key).join(', ')}`,
      );
      await this.handleOwnedKeyChanges(ownedChanges, workspaceSettings);
      return;
    }

    const externalNow = this.stripOwnedKeys(workspaceSettings);
    const delta = this.diffObjects(this.externalBaseline, externalNow);

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
    workspaceSettings: Setting,
  ): Array<{ key: string; newValue: unknown; provenance: KeyProvenance }> {
    const changes: Array<{
      key: string;
      newValue: unknown;
      provenance: KeyProvenance;
    }> = [];

    for (const [key, provenance] of this.provenance.entries()) {
      const currentValue = workspaceSettings[key];
      const isEqual = this.deepEqual(currentValue, provenance.winnerValue);
      log(
        `Comparing "${key}": settings.json=${JSON.stringify(currentValue)} vs provenance=${JSON.stringify(provenance.winnerValue)} | equal=${isEqual}`,
      );
      if (!isEqual) {
        changes.push({ key, newValue: currentValue, provenance });
      }
    }

    return changes;
  }

  private async handleOwnedKeyChanges(
    changes: Array<{
      key: string;
      newValue: unknown;
      provenance: KeyProvenance;
    }>,
    workspaceSettings: Setting,
  ): Promise<void> {
    for (const change of changes) {
      const { key, newValue, provenance } = change;

      if (provenance.overrides.length > 0) {
        await this.handleConflictedKeyChange(key, newValue, provenance);
      } else {
        await this.updateSourceFile(provenance.winner, key, newValue);
      }
    }

    await this.updateExternalBaseline();
  }

  private async handleConflictedKeyChange(
    key: string,
    newValue: unknown,
    provenance: KeyProvenance,
  ): Promise<void> {
    const overrideFiles = provenance.overrides.map((o) => o.file).join(', ');

    const items: vscode.QuickPickItem[] = provenance.overrides.map((o) => ({
      label: `$(arrow-right) Move to ${o.file}`,
      description: `Remove from ${provenance.winner}, add to ${o.file}`,
      detail: `Previous value in ${o.file}: ${JSON.stringify(o.value)}`,
    }));

    items.push(
      ...provenance.overrides.map((o) => ({
        label: `$(trash) Remove from ${o.file}`,
        description: `Keep only in ${provenance.winner}`,
        detail: `Will delete "${key}" from ${o.file}`,
      })),
    );

    const picked = await vscode.window.showQuickPick(items, {
      title: `Conflict: "${key}" exists in multiple files`,
      placeHolder: `Active: ${provenance.winner} | Also in: ${overrideFiles}`,
      ignoreFocusOut: true,
    });

    if (!picked) return;

    if (picked.label.startsWith('$(arrow-right) Move to')) {
      const targetFile = picked.label.replace('$(arrow-right) Move to ', '');
      await this.moveKeyToFile(key, newValue, provenance.winner, targetFile);
    } else if (picked.label.startsWith('$(trash) Remove from')) {
      const targetFile = picked.label.replace('$(trash) Remove from ', '');
      await this.removeKeyFromFile(key, targetFile);
      await this.updateSourceFile(provenance.winner, key, newValue);
    }
  }

  private async updateSourceFile(
    fileName: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    const filePath = path.join(this.getConfigDir(), fileName);

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const config: LayeredConfig = JSON.parse(content);

      if (!config.settings) {
        config.settings = {};
      }

      config.settings[key] = value;
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

      this.provenance.set(key, {
        winner: fileName,
        winnerValue: value,
        overrides: this.provenance.get(key)?.overrides || [],
      });

      this.finalSettings[key] = value;
    } catch (error) {
      console.error(`Failed to update ${fileName}:`, error);
    }
  }

  private async moveKeyToFile(
    key: string,
    value: unknown,
    fromFile: string,
    toFile: string,
  ): Promise<void> {
    await this.removeKeyFromFile(key, fromFile);
    await this.updateSourceFile(toFile, key, value);
    await this.refresh();
  }

  private async removeKeyFromFile(
    key: string,
    fileName: string,
  ): Promise<void> {
    const filePath = path.join(this.getConfigDir(), fileName);

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const config: LayeredConfig = JSON.parse(content);

      if (config.settings && key in config.settings) {
        delete config.settings[key];
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
      }
    } catch (error) {
      console.error(`Failed to remove key from ${fileName}:`, error);
    }
  }

  private diffObjects(prev: Setting, curr: Setting): ExternalDelta {
    const added: Setting = {};
    const changed: Setting = {};
    const removed: string[] = [];

    const prevKeys = new Set(Object.keys(prev));
    const currKeys = new Set(Object.keys(curr));

    for (const k of currKeys) {
      if (!prevKeys.has(k)) {
        added[k] = curr[k];
      } else if (!this.deepEqual(prev[k], curr[k])) {
        changed[k] = curr[k];
      }
    }

    for (const k of prevKeys) {
      if (!currKeys.has(k)) {
        removed.push(k);
      }
    }

    return { added, changed, removed };
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) return false;

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (!bKeys.includes(key)) return false;
      if (!this.deepEqual(aObj[key], bObj[key])) return false;
    }

    return true;
  }

  private async handleExternalDelta(
    delta: ExternalDelta,
    externalNow: Setting,
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
    settingKeys: string[],
  ): Promise<string | undefined> {
    const configDir = this.getConfigDir();
    const existingFiles = this.getExistingConfigFiles();

    const items: vscode.QuickPickItem[] = [
      {
        label: '$(add) Create new file...',
        description: 'Create a new layered config file',
        alwaysShow: true,
      },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      ...existingFiles.map((file) => ({
        label: `$(file) ${file}`,
        description: path.join('.vscode', 'layered-settings', file),
      })),
    ];

    const keysPreview =
      settingKeys.length <= 3
        ? settingKeys.join(', ')
        : `${settingKeys.slice(0, 3).join(', ')}... (+${settingKeys.length - 3} more)`;

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Capture External Settings',
      placeHolder: `Select destination for: ${keysPreview}`,
      ignoreFocusOut: true,
    });

    if (!picked) return undefined;

    if (picked.label.includes('Create new file')) {
      const newFileName = await vscode.window.showInputBox({
        prompt: 'Enter new config file name',
        placeHolder: 'my-settings.json',
        validateInput: (value) => {
          if (!value) return 'File name is required';
          if (!value.endsWith('.json')) return 'File must end with .json';
          if (value === 'config.json') return 'Cannot use config.json';
          if (existingFiles.includes(value)) return 'File already exists';
          if (!/^[\w\-\.]+$/.test(value)) return 'Invalid file name';
          return undefined;
        },
      });

      if (!newFileName) return undefined;

      const newFilePath = path.join(configDir, newFileName);
      const template: LayeredConfig = { settings: {} };
      fs.writeFileSync(newFilePath, JSON.stringify(template, null, 2));

      return newFileName;
    }

    return picked.label.replace('$(file) ', '');
  }

  private getExistingConfigFiles(): string[] {
    const configDir = this.getConfigDir();
    if (!fs.existsSync(configDir)) return [];

    return fs
      .readdirSync(configDir)
      .filter(
        (file) =>
          file.endsWith('.json') && file !== 'config.json' && file !== '.json',
      );
  }

  private async captureToFile(
    fileName: string,
    newSettings: Setting,
  ): Promise<void> {
    const filePath = path.join(this.getConfigDir(), fileName);

    let current: LayeredConfig = { settings: {} };
    try {
      const content = fs.readFileSync(filePath, 'utf8');
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
      `Captured ${Object.keys(newSettings).length} setting(s) to ${fileName}`,
    );
  }

  private async ensureFileInConfig(fileName: string): Promise<void> {
    const configPath = this.getConfigPath();
    if (!fs.existsSync(configPath)) return;

    try {
      const content = fs.readFileSync(configPath, 'utf8');
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

  private async findUpConfigs(folderPath: string): Promise<void> {
    const configPath = path.join(
      folderPath,
      '.vscode',
      this.CONFIG_DIR,
      this.CONFIG_FILENAME,
    );

    if (fs.existsSync(configPath)) {
      const configDir = path.join(folderPath, '.vscode', this.CONFIG_DIR);
      const isRoot = await this.processConfigFile(configPath, configDir);

      if (isRoot) {
        return;
      }
    }

    const parent = path.dirname(folderPath);
    if (parent === folderPath) {
      return;
    }

    await this.findUpConfigs(parent);
  }

  private async processConfigFile(
    configPath: string,
    configDir: string,
  ): Promise<boolean> {
    this.configFiles.push(configPath);

    await this.resolveConfigWithProvenance(configPath, configDir);

    const config = this.parseConfigFile(configPath);
    return config?.root ?? false;
  }

  private async resolveConfigWithProvenance(
    configPath: string,
    baseDir: string,
  ): Promise<void> {
    const absolutePath = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(baseDir, configPath);

    if (this.resolving.has(absolutePath)) {
      vscode.window.showWarningMessage(
        `Circular dependency detected: ${absolutePath}`,
      );
      return;
    }

    this.resolving.add(absolutePath);

    const config = this.parseConfigFile(absolutePath);
    if (!config) {
      this.resolving.delete(absolutePath);
      return;
    }

    if (config.extends) {
      const extendsList = Array.isArray(config.extends)
        ? config.extends
        : [config.extends];
      const configDir = path.dirname(absolutePath);

      for (const extendPath of extendsList) {
        await this.resolveExtendPathWithProvenance(extendPath, configDir);
      }
    }

    if (config.settings) {
      const fileName = path.basename(absolutePath);
      this.mergeSettingsWithProvenance(config.settings, fileName);
    }

    this.resolving.delete(absolutePath);
  }

  private async resolveExtendPathWithProvenance(
    extendPath: string,
    baseDir: string,
  ): Promise<void> {
    if (!extendPath.endsWith('.json')) {
      vscode.window.showErrorMessage('extends must point to a .json file');
      return;
    }

    if (extendPath.startsWith('http://') || extendPath.startsWith('https://')) {
      const settings = await this.fetchFromUrl(extendPath);
      this.mergeSettingsWithProvenance(settings, extendPath);
      return;
    }

    const resolved = path.isAbsolute(extendPath)
      ? extendPath
      : path.resolve(baseDir, extendPath);

    if (!fs.existsSync(resolved)) {
      vscode.window.showErrorMessage(`Extended file not found: ${resolved}`);
      return;
    }

    this.extendedFiles.add(resolved);
    await this.resolveConfigWithProvenance(resolved, path.dirname(resolved));
  }

  private mergeSettingsWithProvenance(
    settings: Setting,
    sourceFile: string,
  ): void {
    for (const [key, value] of Object.entries(settings)) {
      const isLanguageSpecific = /^\[.+\]$/.test(key);

      if (isLanguageSpecific && typeof value === 'object' && value !== null) {
        this.finalSettings[key] = this.finalSettings[key] || {};
        Object.assign(this.finalSettings[key] as object, value);
      } else if (Array.isArray(value)) {
        const existingValue = this.finalSettings[key];
        if (Array.isArray(existingValue)) {
          this.finalSettings[key] = [...existingValue, ...value];
        } else {
          this.finalSettings[key] = value;
        }

        const existing = this.provenance.get(key);
        if (existing) {
          existing.winner = `${existing.winner}, ${sourceFile}`;
          existing.winnerValue = this.finalSettings[key];
        } else {
          this.provenance.set(key, {
            winner: sourceFile,
            winnerValue: value,
            overrides: [],
          });
        }
      } else {
        const existing = this.provenance.get(key);

        if (existing) {
          existing.overrides.push({
            file: existing.winner,
            value: existing.winnerValue,
          });
          existing.winner = sourceFile;
          existing.winnerValue = value;
        } else {
          this.provenance.set(key, {
            winner: sourceFile,
            winnerValue: value,
            overrides: [],
          });
        }

        this.finalSettings[key] = value;
      }
    }
  }

  private parseConfigFile(configPath: string): LayeredConfig | null {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to parse ${configPath}: ${message}`,
      );
      console.error(`Parse error for ${configPath}:`, error);
      return null;
    }
  }

  private async resolveConfigRecursive(
    configPath: string,
    baseDir: string,
  ): Promise<Setting> {
    const absolutePath = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(baseDir, configPath);

    if (this.resolving.has(absolutePath)) {
      vscode.window.showWarningMessage(
        `Circular dependency detected: ${absolutePath}`,
      );
      return {};
    }

    this.resolving.add(absolutePath);

    const config = this.parseConfigFile(absolutePath);
    if (!config) {
      this.resolving.delete(absolutePath);
      return {};
    }

    let mergedSettings: Setting = {};

    if (config.extends) {
      const extendsList = Array.isArray(config.extends)
        ? config.extends
        : [config.extends];
      const configDir = path.dirname(absolutePath);

      for (const extendPath of extendsList) {
        const extendedSettings = await this.resolveExtendPath(
          extendPath,
          configDir,
        );
        mergedSettings = this.mergeObjects(mergedSettings, extendedSettings);
      }
    }

    if (config.settings) {
      mergedSettings = this.mergeObjects(mergedSettings, config.settings);
    }

    this.resolving.delete(absolutePath);
    return mergedSettings;
  }

  private async resolveExtendPath(
    extendPath: string,
    baseDir: string,
  ): Promise<Setting> {
    if (!extendPath.endsWith('.json')) {
      vscode.window.showErrorMessage('extends must point to a .json file');
      return {};
    }

    if (extendPath.startsWith('http://') || extendPath.startsWith('https://')) {
      return this.fetchFromUrl(extendPath);
    }

    const resolved = path.isAbsolute(extendPath)
      ? extendPath
      : path.resolve(baseDir, extendPath);

    if (!fs.existsSync(resolved)) {
      vscode.window.showErrorMessage(`Extended file not found: ${resolved}`);
      return {};
    }

    this.extendedFiles.add(resolved);

    return this.resolveConfigRecursive(resolved, path.dirname(resolved));
  }

  private fetchFromUrl(url: string): Promise<Setting> {
    return new Promise((resolve) => {
      const request = https.get(url, (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => chunks.push(chunk));

        response.on('end', () => {
          try {
            const data = Buffer.concat(chunks).toString();
            const config = JSON.parse(data) as LayeredConfig;

            if (config.settings) {
              resolve(config.settings);
            } else if (!config.extends) {
              resolve(config as Setting);
            } else {
              resolve({});
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to parse URL: ${url}`);
            resolve({});
          }
        });

        response.on('error', () => {
          vscode.window.showErrorMessage(`Failed to fetch: ${url}`);
          resolve({});
        });
      });

      request.on('error', () => {
        vscode.window.showErrorMessage(`Failed to fetch: ${url}`);
        resolve({});
      });

      request.setTimeout(5000, () => {
        request.destroy();
        vscode.window.showErrorMessage(`Timeout fetching: ${url}`);
        resolve({});
      });
    });
  }

  private mergeObjects(target: Setting, source: Setting): Setting {
    const result = { ...target };

    for (const [key, value] of Object.entries(source)) {
      const isLanguageSpecific = /^\[.+\]$/.test(key);

      if (isLanguageSpecific && typeof value === 'object' && value !== null) {
        result[key] = result[key] || {};
        Object.assign(result[key] as object, value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private mergeSettings(incoming: Setting): void {
    this.finalSettings = this.mergeObjects(this.finalSettings, incoming);
  }
}
