# cul-de-sac

*A perspective puzzle in six houses.* A dream of a suburb where **if it looks connected, it is**:
line broken pieces of the world up from your point of view and they become whole.

## Play

Double-click **`Play.command`** (macOS), or run this in the folder:

```bash
node tools/serve.mjs
```

then open <http://localhost:5173>. Chrome, Safari, Edge or Firefox with WebGL2. Headphones help.
A PS5 controller works over USB or Bluetooth (press any button once the page is open).

| | Keyboard + mouse | PS5 controller |
|---|---|---|
| Walk | W A S D · click a tile | Left stick · D-pad |
| Look around | drag · arrow keys · Q / E | Right stick |
| Zoom | scroll · `-` `=` | L2 / R2 |
| Interact | Space | ✕ |
| Undo (No. 2) | Z | □ |
| Hint | H | △ |
| Restart house | hold R | hold Create |
| Recenter view | C | R3 |
| Pause | Esc | Options |

## The houses

0. **Mailbox**: the tutorial. Walk, look, line something up.
1. **Front Walk**: morning. Pieces of the street, a house sunk in its lot, a house in slices.
2. **Mow Day**: noon. Kick the driverless mower; it carves the only paths there are, even down walls.
3. **Turntable**: golden hour. Brass plates turn a whole lot a quarter turn; the last stretch is still in pieces.
4. **Underside**: dusk. There is another street beneath this one.
5. **Night Mow**: everything at once. Lawn on every face of the world, a mower that laps it, a strip to dock, and a garage hanging underneath. Colours turn inside out down there.

## Under the hood

Plain ES modules + three.js r187 (vendored in `vendor/`), no build step.

- `src/core/`: renderer and post stack, orthographic camera rig, input, tile graph (walkable
  faces connect by shared edges, so walls and undersides just work), illusions, materials
  (shell-rendered velvet grass, strata earth, op-art), particles, procedural audio.
- `src/levels/`: the three houses. `level2map.js` and `level5map.js` are the mower puzzles; `node tools/solve2.mjs` and
  `node tools/solve5.mjs` prove they're solvable and that each needs its floating lawn strip.
- `src/world/`: the house builder (it can build a house in slices) and the props.
- `DESIGN.md`: the design notes.
