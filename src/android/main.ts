// SPDX-License-Identifier: MPL-2.0
import '../entrypoints/sidepanel/style.css';
import './style.css';
import { AndroidApp } from './AndroidApp';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) throw new Error('The ProtPeek app root is missing.');
const app = new AndroidApp(root);
window.ProtPeekAndroidUI = { back: () => app.handleBack() };
void app.initialize();
window.addEventListener('pagehide', () => { app.dispose(); delete window.ProtPeekAndroidUI; }, { once: true });
