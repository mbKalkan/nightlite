import * as vscode from 'vscode';

/**
 * Calls `onChange` once a database file settles after changing on disk: the file itself, or
 * its write-ahead log, where a program writing in WAL mode puts its changes until a
 * checkpoint. Writers touch the file many times in one commit, so events are gathered first.
 */
export function watchDatabase(
  uri: vscode.Uri,
  onChange: () => void,
  delayMs = 400,
): vscode.Disposable {
  const folder = vscode.Uri.joinPath(uri, '..');
  const fileName = uri.path.slice(uri.path.lastIndexOf('/') + 1);
  // Glob characters in the name match any character; events are checked by name below.
  const glob = `${fileName.replace(/[*?[\]{}!]/g, '?')}*`;
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, glob),
  );
  const targets = new Set(
    [uri.toString(), `${uri.toString()}-wal`].map((name) => name.toLowerCase()),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const onEvent = (changed: vscode.Uri) => {
    if (!targets.has(changed.toString().toLowerCase())) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, delayMs);
  };
  const subscriptions = [
    watcher,
    watcher.onDidChange(onEvent),
    watcher.onDidCreate(onEvent),
    watcher.onDidDelete(onEvent),
  ];
  return new vscode.Disposable(() => {
    clearTimeout(timer);
    subscriptions.forEach((subscription) => subscription.dispose());
  });
}
