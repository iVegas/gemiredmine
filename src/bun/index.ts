import { buildInfo } from '../shared/build-info.generated';
import { ViewWindows } from './windows/view-windows';
import { electrobunHost } from './windows/electrobun-host';

// The main window, and the windows that view tabs are dragged out into.
const windows = new ViewWindows(electrobunHost, buildInfo.productName);
windows.openMain({ x: 0, y: 0, width: 1024, height: 768 });
