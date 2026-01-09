import * as vscode from 'vscode';
import * as logger from '../utils/logger';

export type WatchedFile = {
  path: string;
  watcher: vscode.FileSystemWatcher;
};

export class FileWatcherManager {
  private watchers: WatchedFile[] = [];
  private directoryWatcher: vscode.FileSystemWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(
    private readonly pattern: string,
    private readonly onChangeCallback: () => void,
    debounceMs = 300,
  ) {
    this.debounceMs = debounceMs;
  }

  setupDirectoryWatcher(): void {
    logger.log(`Setting up directory watcher for: ${this.pattern}`);
    this.directoryWatcher = vscode.workspace.createFileSystemWatcher(
      this.pattern,
    );

    this.directoryWatcher.onDidCreate(() => this.debouncedCallback());
    this.directoryWatcher.onDidDelete(() => this.debouncedCallback());
    this.directoryWatcher.onDidChange(() => this.debouncedCallback());
  }

  setupFileWatchers(filePaths: string[]): void {
    this.clearFileWatchers();

    for (const filePath of filePaths) {
      const watcher = vscode.workspace.createFileSystemWatcher(filePath);

      watcher.onDidChange(() => this.debouncedCallback());
      watcher.onDidDelete(() => this.debouncedCallback());

      this.watchers.push({ path: filePath, watcher });
    }

    logger.log(`Set up ${this.watchers.length} file watchers`);
  }

  private debouncedCallback(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.onChangeCallback();
    }, this.debounceMs);
  }

  private clearFileWatchers(): void {
    for (const watched of this.watchers) {
      watched.watcher.dispose();
    }
    this.watchers = [];
  }

  dispose(): void {
    this.clearFileWatchers();
    if (this.directoryWatcher) {
      this.directoryWatcher.dispose();
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }
}

export class SettingsFileWatcher {
  private settingsWatcher: vscode.FileSystemWatcher | null = null;
  private configChangeDisposable: vscode.Disposable | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(
    private readonly settingsPath: string,
    private readonly onChangeCallback: () => void,
    private readonly shouldSkip: () => boolean,
    debounceMs = 300,
  ) {
    this.debounceMs = debounceMs;
  }

  setup(): void {
    logger.log(`Setting up settings watcher for: ${this.settingsPath}`);
    this.settingsWatcher = vscode.workspace.createFileSystemWatcher(
      this.settingsPath,
    );

    this.settingsWatcher.onDidChange(() => {
      logger.log('settings.json changed (file watcher)');
      this.debouncedCallback();
    });
    this.settingsWatcher.onDidCreate(() => {
      logger.log('settings.json created (file watcher)');
      this.debouncedCallback();
    });

    this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration(
      () => {
        logger.log('Configuration changed (VSCode API)');
        this.debouncedCallback();
      },
    );
  }

  private debouncedCallback(): void {
    logger.log(`debouncedExternalCheck called, shouldSkip: ${this.shouldSkip()}`);
    if (this.shouldSkip()) {
      logger.log('Skipping - currently applying settings');
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      logger.log('Debounce timer fired');
      this.onChangeCallback();
    }, this.debounceMs);
  }

  dispose(): void {
    if (this.settingsWatcher) {
      this.settingsWatcher.dispose();
    }
    if (this.configChangeDisposable) {
      this.configChangeDisposable.dispose();
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }
}
