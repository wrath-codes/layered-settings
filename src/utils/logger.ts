import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | null = null;

export function initLogger(channel: vscode.OutputChannel): void {
  outputChannel = channel;
}

export function log(message: string): void {
  outputChannel?.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const errorMsg = error instanceof Error ? error.message : String(error);
  outputChannel?.appendLine(
    `[${new Date().toLocaleTimeString()}] ERROR: ${message}${error ? `: ${errorMsg}` : ''}`,
  );
}
