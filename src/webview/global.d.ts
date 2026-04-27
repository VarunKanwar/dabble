declare function acquireVsCodeApi<State = unknown>(): {
  postMessage(message: unknown): void;
  getState(): State | undefined;
  setState(newState: State): void;
};
