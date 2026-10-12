import { BrowserWindow } from 'electrobun';
import { buildInfo } from '../shared/build-info.generated';
import { rpc } from './rpc';

// The window is initialised by its constructor; no separate init call is needed.
const win = new BrowserWindow({
    title: buildInfo.productName,
    url: 'views://mainview/index.html',
    frame: {
        x: 0,
        y: 0,
        width: 1024,
        height: 768,
    },
    rpc,
});

