import * as vscode from 'vscode';
import { tileBytes } from './tileFile';

const IMAGES = ['png', 'jpg', 'webp', 'gif'];

/**
 * Asks where to save a tile, offering `name` next to the tileset, and writes it there. Only the
 * file the user picks is written; the tileset is left alone.
 */
export async function saveTile(tileset: vscode.Uri, name: string, stored: Uint8Array) {
  const extension = name.slice(name.lastIndexOf('.') + 1);
  let filters: Record<string, string[]> | undefined;
  if (extension === 'pbf') {
    filters = {
      [vscode.l10n.t('Vector tiles')]: ['pbf', 'mvt'],
      [vscode.l10n.t('Gzip-compressed vector tiles')]: ['gz'],
    };
  } else if (IMAGES.includes(extension)) {
    filters = { [vscode.l10n.t('Images')]: [extension] };
  }
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(tileset, '..', name),
    filters,
    title: vscode.l10n.t('Save Tile'),
  });
  if (!target) return;
  try {
    await vscode.workspace.fs.writeFile(target, tileBytes(stored, target.path));
    const saved = target.path.slice(target.path.lastIndexOf('/') + 1);
    vscode.window.setStatusBarMessage(vscode.l10n.t('Saved {0}', saved), 4000);
  } catch (error) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("The tile couldn't be saved: {0}", (error as Error).message),
    );
  }
}
