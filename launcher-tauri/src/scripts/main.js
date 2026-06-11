import { renderAppShell } from './ui/shell.js';

renderAppShell(document.getElementById('app-root'));

Promise.resolve()
    .then(() => import('./mock-api.js'))
    .then(() => import('./app.js'));
