import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ConfigMerger, deepEqual } from '../core/config-merger';
import { createConflictDiagnostics } from '../core/conflict-manager';
import { FileWatcherManager, SettingsFileWatcher } from '../core/file-watcher';
import type {
  ConfigProvider,
  ExternalDelta,
  KeyProvenance,
  LayeredConfig,
  ProvenanceMap,
  Setting,
} from '../core/types';
import { log } from '../utils/logger';

export class SettingsProvider implements ConfigProvider {
  readonly configDir: string;
  readonly configFilename = 'config.json';

  private merger: ConfigMerger;
  private fileWatcher: FileWatcherManager;
  private settingsWatcher: SettingsFileWatcher;
  private statusBarItem: vscode.StatusBarItem;
  private isApplyingSettings = false;
  private ownedKeys: Set<string> = new Set();
  private provenance: ProvenanceMap = new Map();
  private externalBaseline: Setting = {};

  constructor(
    private readonly folderPath: string,
    statusBarItem: vscode.StatusBarItem,
  ) {
    this.configDir = path.join(
      folderPath,
      '.vscode',
      'layered-settings',
      'settings',
    );
    this.statusBarItem = statusBarItem;

    this.merger = new ConfigMerger(this.configDir);

    this.fileWatcher = new FileWatcherManager(
      path.join(this.configDir, '**/*.json'),
      () => this.rebuild(),
    );

    this.settingsWatcher = new SettingsFileWatcher(
      path.join(folderPath, '.vscode', 'settings.json'),
      () => this.detectExternalChanges(),
      () => this.isApplyingSettings,
    );
  }

  async initialize(): Promise<void> {
    log('Initializing SettingsProvider');
    this.fileWatcher.setupDirectoryWatcher();
    this.settingsWatcher.setup();
    await this.rebuild();
    log(
      `Initialization complete. Owned keys: ${this.ownedKeys.size}, Provenance: ${this.provenance.size}`,
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
    const configPath = path.join(this.configDir, this.configFilename);

    if (!fs.existsSync(configPath)) {
      this.updateStatusBar('$(info) No config found');
      return;
    }

    await this.merger.mergeFromConfig(configPath);

    this.provenance = this.merger.getProvenance();
    this.ownedKeys = this.merger.getOwnedKeys();

    const conflicts = this.merger.getConflictedKeys();
    await createConflictDiagnostics(conflicts, this.provenance, this.configDir);

    await this.applySettings();

    const extendedFiles = [...this.merger.getExtendedFiles()];
    this.fileWatcher.setupFileWatchers(extendedFiles);
  }

  private async applySettings(): Promise<void> {
    this.isApplyingSettings = true;

    try {
      const config = vscode.workspace.getConfiguration();
      const settings = this.merger.getSettings();

      for (const [key, value] of Object.entries(settings)) {
        try {
          await config.update(key, value, vscode.ConfigurationTarget.Workspace);
        } catch (error) {
          console.error(`Failed to update setting "${key}":`, error);
        }
      }

      await this.updateExternalBaseline();
      this.updateStatusBar(
        `$(check) ${Object.keys(settings).length} settings applied`,
      );
    } finally {
      this.isApplyingSettings = false;
    }
  }

  private async updateExternalBaseline(): Promise<void> {
    const workspaceSettings = this.getWorkspaceSettingsObject();
    this.externalBaseline = this.stripOwnedKeys(workspaceSettings);
  }

  private getWorkspaceSettingsObject(): Setting {
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

    if (this.ownedKeys.size === 0) {
      log('No owned keys, skipping');
      return;
    }

    const workspaceSettings = this.getWorkspaceSettingsObject();

    const ownedChanges = this.detectOwnedKeyChanges(workspaceSettings);
    if (ownedChanges.length > 0) {
      log(
        `Processing owned changes: ${ownedChanges.map((c) => c.key).join(', ')}`,
      );
      await this.handleOwnedKeyChanges(ownedChanges);
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

    for (const [key, prov] of this.provenance.entries()) {
      const currentValue = workspaceSettings[key];
      if (!deepEqual(currentValue, prov.winnerValue)) {
        changes.push({ key, newValue: currentValue, provenance: prov });
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
  ): Promise<void> {
    for (const change of changes) {
      const { key, newValue, provenance } = change;

      if (provenance.overrides.length > 0) {
        // Has conflicts - let user resolve via diagnostics
        continue;
      }

      await this.updateSourceFile(provenance.winner, key, newValue);
    }

    await this.updateExternalBaseline();
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
        description: path.join('.vscode', 'layered-settings', 'settings', file),
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

      const newFilePath = path.join(this.configDir, newFileName);
      const template: LayeredConfig = { settings: {} };
      fs.writeFileSync(newFilePath, JSON.stringify(template, null, 2));

      return newFileName;
    }

    return picked.label.replace('$(file) ', '');
  }

  private getExistingConfigFiles(): string[] {
    if (!fs.existsSync(this.configDir)) return [];

    return fs
      .readdirSync(this.configDir)
      .filter(
        (file) =>
          file.endsWith('.json') && file !== 'config.json' && file !== '.json',
      );
  }

  private async captureToFile(
    fileName: string,
    newSettings: Setting,
  ): Promise<void> {
    const filePath = path.join(this.configDir, fileName);

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
    const configPath = path.join(this.configDir, this.configFilename);
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

  private async updateSourceFile(
    fileName: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    const filePath = path.join(this.configDir, fileName);

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const config: LayeredConfig = JSON.parse(content);

      if (!config.settings) {
        config.settings = {};
      }

      config.settings[key] = value;
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

      log(`Updated "${key}" in ${fileName}`);
    } catch (error) {
      console.error(`Failed to update ${fileName}:`, error);
    }
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

    log(`Resolved conflict for "${key}" - kept in ${chosenFile}`);
    await this.refresh();
  }

  private async removeKeyFromFile(
    key: string,
    fileName: string,
  ): Promise<void> {
    const filePath = path.join(this.configDir, fileName);

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
      } else if (!deepEqual(prev[k], curr[k])) {
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

  private updateStatusBar(text: string): void {
    this.statusBarItem.text = text;
    this.statusBarItem.show();
  }
}
