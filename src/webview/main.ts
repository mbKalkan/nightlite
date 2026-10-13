import './styles/viewer.css';
import type { HostToWebviewMessage } from '../shared/protocol';
import { Shell } from './shell';
import { vscode } from './vscodeApi';

const shell = new Shell(document.getElementById('app') as HTMLElement);
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
  }
});

vscode.postMessage({ type: 'ready' });
