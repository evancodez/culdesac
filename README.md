# cul-de-sac

*A perspective puzzle in three houses.* A dream of a suburb where **if it looks connected, it is**:
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

1. **Front Walk**: morning. Pieces of the street, a house sunk in its lot, a house in slices.
2. **Mow Day**: noon. Kick the driverless mower; it carves the only paths there are, even down walls.
3. **Underside**: dusk. There is another street beneath this one.

## Under the hood

Plain ES modules + three.js r187 (vendored in `vendor/`), no build step.

- `src/core/`: renderer and post stack, orthographic camera rig, input, tile graph (walkable
  faces connect by shared edges, so walls and undersides just work), illusions, materials
  (shell-rendered velvet grass, strata earth, op-art), particles, procedural audio.
- `src/levels/`: the three houses. `level2map.js` is the mower puzzle layout. Check it with
  `node tools/solve2.mjs`, which proves it's solvable and that it needs the floating lawn strip.
- `src/world/`: the house builder (it can build a house in slices) and the props.
- `DESIGN.md`: the design notes.
