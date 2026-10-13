import './styles/viewer.css';
import type { HostToWebviewMessage } from '../shared/protocol';
import type { EntryKey } from './objectTree';
import { Shell } from './shell';
import { vscode, type ViewState } from './vscodeApi';

const state: ViewState = vscode.getState() ?? {};
const shell = new Shell(document.getElementById('app') as HTMLElement, (key: EntryKey) => {
  state.selected = key;
  vscode.setState(state);
});
let loaded = false;

// Show progress only if the first answer is slow, so quick loads don't flash.
const loadingTimer = setTimeout(() => {
  if (!loaded) {
    shell.showLoading();
  }
}, 250);

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  loaded = true;
  clearTimeout(loadingTimer);
  switch (message.type) {
    case 'load':
      shell.showFile(message.file, message.locale, message.strings);
      break;
    case 'error':
      shell.showError(message.fileName, message.error, message.strings);
      break;
    case 'schema':
      shell.showSchema(message.objects, state.selected);
      break;
    case 'schemaError':
      shell.showSchemaError(message.error, message.detail);
      break;
    case 'reveal':
      shell.reveal(message.name);
      break;
  }
});

vscode.postMessage({ type: 'ready' });
