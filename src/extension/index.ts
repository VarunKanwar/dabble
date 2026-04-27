import type * as vscode from "vscode";
import { activateDuckView, deactivateDuckView } from "./duckviewProvider";

export function activate(context: vscode.ExtensionContext): vscode.Disposable {
  return activateDuckView(context);
}

export function deactivate(): void {
  deactivateDuckView();
}
