import type * as vscode from 'vscode';
import { ViewerProvider } from './viewerProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(ViewerProvider.register(context));
}

export function deactivate(): void {}
