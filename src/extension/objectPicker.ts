import * as vscode from 'vscode';
import type { ObjectType, SchemaObject } from '../shared/protocol';

const ICONS: Record<ObjectType, string> = {
  table: 'table',
  view: 'eye',
  index: 'key',
  trigger: 'zap',
};

/** Lists the database's objects in VS Code's quick pick, grouped by kind; resolves to a name. */
export async function pickObject(objects: readonly SchemaObject[]): Promise<string | undefined> {
  const groups: [ObjectType, string][] = [
    ['table', vscode.l10n.t('Tables')],
    ['view', vscode.l10n.t('Views')],
    ['index', vscode.l10n.t('Indexes')],
    ['trigger', vscode.l10n.t('Triggers')],
  ];
  const items: (vscode.QuickPickItem & { name?: string })[] = [];
  for (const [type, title] of groups) {
    const members = objects.filter((object) => object.type === type);
    if (members.length === 0) {
      continue;
    }
    items.push({ label: title, kind: vscode.QuickPickItemKind.Separator });
    for (const object of members) {
      items.push({
        label: `$(${ICONS[type]}) ${object.name}`,
        description:
          object.tableName !== object.name ? vscode.l10n.t('on {0}', object.tableName) : undefined,
        name: object.name,
      });
    }
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t('Go to a table, view, index or trigger'),
    matchOnDescription: true,
  });
  return picked?.name;
}
