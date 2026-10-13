import type {
  DatabaseError,
  FileInfo,
  LoadError,
  SchemaObject,
  ViewerStrings,
} from '../shared/protocol';
import { ObjectTree, objectKey, type EntryKey } from './objectTree';
import { databaseErrorMessage, element, messageView, objectView, overviewView } from './views';

/** The viewer's frame: the file name on top, the database's objects on the left, content right. */
export class Shell {
  private readonly fileName: HTMLElement;
  private readonly sidebar: HTMLElement;
  private readonly content: HTMLElement;
  private file: { info: FileInfo; locale: string; strings: ViewerStrings } | undefined;
  private objects = new Map<EntryKey, SchemaObject>();
  private tree: ObjectTree | undefined;
  private schemaError: { error: DatabaseError; detail: string } | undefined;

  constructor(
    root: HTMLElement,
    private readonly onSelect: (key: EntryKey) => void,
  ) {
    root.innerHTML = `
      <div class="nl-shell">
        <header class="nl-toolbar">
          <span class="nl-file-name"></span>
        </header>
        <div class="nl-body">
          <nav class="nl-sidebar" hidden></nav>
          <main class="nl-content" tabindex="-1"></main>
        </div>
      </div>`;
    this.fileName = root.querySelector('.nl-file-name') as HTMLElement;
    this.sidebar = root.querySelector('.nl-sidebar') as HTMLElement;
    this.content = root.querySelector('.nl-content') as HTMLElement;
  }

  /** A thin progress bar, as VS Code shows above a loading view. Strings arrive with the file. */
  showLoading(): void {
    this.content.setAttribute('aria-busy', 'true');
    this.content.replaceChildren(element('div', 'nl-progress'));
  }

  showFile(info: FileInfo, locale: string, strings: ViewerStrings): void {
    this.file = { info, locale, strings };
    this.setFileName(info.fileName);
    this.sidebar.setAttribute('aria-label', strings.databaseObjects);
    this.show('overview');
    // Until the schema arrives the database is still opening.
    this.content.setAttribute('aria-busy', 'true');
  }

  /** Lists the objects and shows `selected` if the database still has it, else the overview. */
  showSchema(objects: SchemaObject[], selected: EntryKey | undefined): void {
    if (!this.file) return;
    const { strings } = this.file;
    this.schemaError = undefined;
    this.objects = new Map(objects.map((object) => [objectKey(object), object]));
    this.tree = new ObjectTree(objects, strings, (key) => {
      this.show(key);
      this.onSelect(key);
    });
    const parts: HTMLElement[] = [this.tree.element];
    if (!objects.some((object) => object.type === 'table')) {
      parts.push(element('p', 'nl-sidebar-note', strings.noTables));
    }
    this.sidebar.replaceChildren(...parts);
    this.sidebar.hidden = false;
    this.content.removeAttribute('aria-busy');
    this.tree.select(selected && this.tree.has(selected) ? selected : 'overview');
  }

  /** The header was readable but the database wasn't: say why below the header's facts. */
  showSchemaError(error: DatabaseError, detail: string): void {
    this.schemaError = { error, detail };
    this.sidebar.hidden = true;
    this.content.removeAttribute('aria-busy');
    this.show('overview');
  }

  showError(fileName: string, error: LoadError, strings: ViewerStrings): void {
    this.setFileName(fileName);
    this.sidebar.hidden = true;
    const messages: Record<LoadError, string> = {
      empty: strings.errorEmpty,
      notSqlite: strings.errorNotSqlite,
      unreadable: strings.errorUnreadable,
      notOnDisk: strings.errorNotOnDisk,
    };
    this.content.removeAttribute('aria-busy');
    this.content.replaceChildren(messageView(strings.errorTitle, messages[error]));
  }

  /** Shows an object picked elsewhere, like Go to Table, and puts the keyboard on it. */
  reveal(name: string): void {
    const object = [...this.objects.values()].find((candidate) => candidate.name === name);
    if (object) {
      this.tree?.select(objectKey(object), true);
    }
  }

  private show(key: EntryKey): void {
    if (!this.file) return;
    const { info, locale, strings } = this.file;
    const object = this.objects.get(key);
    if (object) {
      this.content.replaceChildren(objectView(object, strings));
      return;
    }
    const parts: HTMLElement[] = [overviewView(info, locale, strings)];
    if (this.schemaError) {
      parts.push(
        messageView(
          strings.openErrorTitle,
          databaseErrorMessage(this.schemaError.error, strings),
          this.schemaError.detail,
        ),
      );
    }
    this.content.replaceChildren(...parts);
  }

  private setFileName(name: string): void {
    this.fileName.textContent = name;
    this.content.setAttribute('aria-label', name);
  }
}
