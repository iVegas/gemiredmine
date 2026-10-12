import { mount } from 'svelte';
import './index.css';
import App from './App.svelte';
import { installDiagnosticsHooks } from './dev-preview.generated';
import { buildInfo } from '../shared/build-info.generated';

document.title = buildInfo.productName;
installDiagnosticsHooks?.();

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
