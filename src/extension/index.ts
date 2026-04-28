import type * as vscode from "vscode";
import { activateDabble, deactivateDabble } from "./dabbleProvider";

export function activate(context: vscode.ExtensionContext): vscode.Disposable {
  return activateDabble(context);
}

export function deactivate(): void {
  deactivateDabble();
}
