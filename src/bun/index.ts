import Electrobun, { BrowserWindow } from 'electrobun';
import { rpc } from './rpc';

const win = new BrowserWindow({
    title: 'Gemiredmine',
    url: 'views://mainview/index.html',
    frame: {
        width: 1024,
        height: 768,
    },
    rpc,
});

Electrobun.events.on('will-finish-launching', () => {
    // Add any initialization logic here
});

Electrobun.events.on('app-ready', () => {
    win.init();
});
