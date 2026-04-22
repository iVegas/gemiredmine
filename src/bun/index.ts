import { Electrobun, BrowserWindow } from 'electrobun';

const win = new BrowserWindow({
    title: 'Gemiredmine',
    url: 'views://mainview/index.html',
    frame: {
        width: 1024,
        height: 768,
    }
});

Electrobun.events.on('will-finish-launching', () => {
    // Add any initialization logic here
});

Electrobun.events.on('app-ready', () => {
    win.init();
});
