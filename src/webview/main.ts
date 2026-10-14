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
    onTileView: (view) => {
      state.tile = view.tile;
      state.scheme = view.scheme;
      state.hiddenLayers = [...view.hidden];
      vscode.setState(state);
    },
    send: (message) => vscode.postMessage(message),
  },
  {
    tab: state.tab ?? 'data',
    detail: state.detail ?? false,
    detailWidth: state.detailWidth,
    tileView: {
      tile: state.tile,
      scheme: state.scheme ?? 'xyz',
      hidden: new Set(state.hiddenLayers ?? []),
    },
  },
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
    case 'objectDetails':
    case 'objectDetailsError':
      shell.detailsMessage(message);
      break;
    case 'tableSummary':
    case 'tableSummariesEnd':
      shell.tablesMessage(message);
      break;
    case 'mbtiles':
    case 'mbtilesError':
    case 'zoomRange':
    case 'zoomCount':
    case 'zoomCountsEnd':
      shell.tilesMessage(message);
      break;
    case 'tilePage':
    case 'tilePosition':
    case 'tileContent':
    case 'tilesError':
      shell.tileMessage(message);
      break;
    case 'metadataState':
    case 'metadataError':
      shell.metadataMessage(message);
      break;
  }
});

vscode.postMessage({ type: 'ready' });
