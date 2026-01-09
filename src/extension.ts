import * as vscode from 'vscode';
import {
  ConflictCodeActionProvider,
  initDiagnostics,
} from './core/conflict-manager';
import { SettingsProvider } from './providers/settings-provider';
import { initLogger } from './utils/logger';

let settingsProvider: SettingsProvider | null = null;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Layered Settings');
  context.subscriptions.push(outputChannel);
  initLogger(outputChannel);

  diagnosticCollection =
    vscode.languages.createDiagnosticCollection('layered-settings');
  context.subscriptions.push(diagnosticCollection);
  initDiagnostics(diagnosticCollection);

  outputChannel.appendLine('Layered Settings: Activating...');

  const { workspaceFolders } = vscode.workspace;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    outputChannel.appendLine('No workspace folder, exiting');
    return;
  }

  outputChannel.appendLine(
    `Workspace folder: ${workspaceFolders[0].uri.fsPath}`,
  );

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = 'layered-settings.refresh';
  statusBarItem.tooltip = 'Click to refresh layered settings';
  context.subscriptions.push(statusBarItem);

  const folderPath = workspaceFolders[0].uri.fsPath;
  settingsProvider = new SettingsProvider(folderPath, statusBarItem);
  settingsProvider.initialize();

  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { pattern: '**/.vscode/layered-settings/**/*.json' },
    new ConflictCodeActionProvider(),
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  );
  context.subscriptions.push(codeActionProvider);

  const resolveCommand = vscode.commands.registerCommand(
    'layered-settings.resolveConflict',
    async (key: string, chosenFile: string, allFiles: string[]) => {
      if (settingsProvider) {
        await settingsProvider.resolveConflictAction(key, chosenFile, allFiles);
      }
    },
  );
  context.subscriptions.push(resolveCommand);

  const refreshCommand = vscode.commands.registerCommand(
    'layered-settings.refresh',
    async () => {
      if (settingsProvider) {
        statusBarItem.text = '$(sync~spin) Refreshing...';
        await settingsProvider.refresh();
        vscode.window.showInformationMessage('Layered Settings refreshed');
      }
    },
  );
  context.subscriptions.push(refreshCommand);

  const showStatusCommand = vscode.commands.registerCommand(
    'layered-settings.showStatus',
    () => {
      vscode.window.showInformationMessage(
        `Layered Settings: ${statusBarItem.text}`,
      );
    },
  );
  context.subscriptions.push(showStatusCommand);

  const openConfigCommand = vscode.commands.registerCommand(
    'layered-settings.openConfig',
    async () => {
      const baseDir = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        '.vscode',
        'layered-settings',
      );
      const settingsDir = vscode.Uri.joinPath(baseDir, 'settings');
      const configPath = vscode.Uri.joinPath(settingsDir, 'config.json');

      try {
        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc);
      } catch {
        const create = await vscode.window.showInformationMessage(
          'Layered settings config not found. Create it?',
          'Yes',
          'No',
        );

        if (create === 'Yes') {
          await vscode.workspace.fs.createDirectory(baseDir);
          await vscode.workspace.fs.createDirectory(settingsDir);
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(baseDir, 'keybindings'),
          );
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(baseDir, 'mcp'),
          );

          const template = {
            root: true,
            extends: [],
            settings: {},
          };

          await vscode.workspace.fs.writeFile(
            configPath,
            Buffer.from(JSON.stringify(template, null, 2)),
          );

          const doc = await vscode.workspace.openTextDocument(configPath);
          await vscode.window.showTextDocument(doc);
        }
      }
    },
  );
  context.subscriptions.push(openConfigCommand);

  context.subscriptions.push({
    dispose: () => {
      if (settingsProvider) {
        settingsProvider.dispose();
      }
    },
  });
}

export function deactivate(): void {
  if (settingsProvider) {
    settingsProvider.dispose();
    settingsProvider = null;
  }
}
