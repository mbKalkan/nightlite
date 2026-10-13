import './styles/viewer.css';
import type { HostToWebviewMessage } from '../shared/protocol';
import { Shell } from './shell';
import { vscode, type ViewState } from './vscodeApi';

const state: ViewState = vscode.getState() ?? {};
const shell = new Shell(
  document.getElementById('app') as HTMLElement,
  {
    onSelect: (key) => {
      state.selected = key;
      vscode.setState(state);
    },
    onTab: (tab) => {
      state.tab = tab;
      vscode.setState(state);
    },
    onDetail: (open) => {
      state.detail = open;
      vscode.setState(state);
    },
    onDetailWidth: (width) => {
      state.detailWidth = width;
      vscode.setState(state);
    },
    send: (message) => vscode.postMessage(message),
  },
  { tab: state.tab ?? 'data', detail: state.detail ?? false, detailWidth: state.detailWidth },
);
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
    case 'objectInfo':
    case 'rowCount':
    case 'rowPage':
    case 'objectError':
    case 'copied':
    case 'cellValue':
      shell.dataMessage(message);
      break;
    case 'mbtiles':
    case 'mbtilesError':
    case 'zoomRange':
    case 'zoomCount':
    case 'zoomCountsEnd':
      shell.tilesMessage(message);
      break;
  }
});

vscode.postMessage({ type: 'ready' });
