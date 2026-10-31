import { Game } from './game.js';

const canvas = document.getElementById('c');
try {
  const game = new Game(canvas);
  window.__game = game; // handy for debugging in the console
  game.boot();
} catch (e) {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;inset:auto 0 40% 0;text-align:center;font:16px Georgia;color:#fff">This needs a browser with WebGL2. (${e.message})</p>`);
}
