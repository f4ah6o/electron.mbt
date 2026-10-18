'use strict';
// Why no window here: the B6-B probe creates its own BrowserWindow so it can
// inspect the preload exposure event and the page-world API boundary directly.
const { app } = require('electron');
app.whenReady().then(() => {});
