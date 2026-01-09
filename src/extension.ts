import * as vscode from 'vscode';
import {
  SettingsMerger,
  setOutputChannel,
  setDiagnosticCollection,
} from './settings-merger';

let merger: SettingsMerger | null = null;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Layered Settings');
  context.subscriptions.push(outputChannel);
  setOutputChannel(outputChannel);

  diagnosticCollection =
    vscode.languages.createDiagnosticCollection('layered-settings');
  context.subscriptions.push(diagnosticCollection);
  setDiagnosticCollection(diagnosticCollection);

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
  merger = new SettingsMerger(folderPath, statusBarItem);
  merger.initialize();

  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { pattern: '**/.vscode/layered-settings/*.json' },
    new ConflictCodeActionProvider(),
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  );
  context.subscriptions.push(codeActionProvider);

  const resolveCommand = vscode.commands.registerCommand(
    'layered-settings.resolveConflict',
    async (key: string, chosenFile: string, allFiles: string[]) => {
      if (merger) {
        await merger.resolveConflictAction(key, chosenFile, allFiles);
      }
    },
  );
  context.subscriptions.push(resolveCommand);

  const refreshCommand = vscode.commands.registerCommand(
    'layered-settings.refresh',
    async () => {
      if (merger) {
        statusBarItem.text = '$(sync~spin) Refreshing...';
        await merger.refresh();
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
      const configDir = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        '.vscode',
        'layered-settings',
      );
      const configPath = vscode.Uri.joinPath(configDir, 'config.json');

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
          await vscode.workspace.fs.createDirectory(configDir);

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
      if (merger) {
        merger.dispose();
      }
    },
  });
}

export function deactivate(): void {
  if (merger) {
    merger.dispose();
    merger = null;
  }
}

class ConflictCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'layered-settings') continue;

      const data = (diagnostic as { data?: ConflictData }).data;
      if (!data) continue;

      for (const file of data.allFiles) {
        const action = new vscode.CodeAction(
          `Keep "${data.key}" in ${file}`,
          vscode.CodeActionKind.QuickFix,
        );
        action.command = {
          command: 'layered-settings.resolveConflict',
          title: `Resolve conflict for ${data.key}`,
          arguments: [data.key, file, data.allFiles],
        };
        action.diagnostics = [diagnostic];
        action.isPreferred = file === data.allFiles[0];
        actions.push(action);
      }
    }

    return actions;
  }
}

type ConflictData = {
  key: string;
  allFiles: string[];
};
