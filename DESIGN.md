# cul-de-sac — design notes

*A perspective puzzle in three houses.*

## The one rule
**If it looks connected, it is.** The suburb is a dream that believes whatever you see.
When broken pieces of the world line up perfectly from your point of view, they become
whole: the pieces slide along your line of sight into place (from the aligned view
nothing seems to move; it just *becomes* true), then the camera eases away to show what
your perspective built.

Everything else grows from that rule plus one piece of dream logic borrowed from the
reference renders: **gravity follows the path.** Roads, walks and mown stripes keep you
stuck to them when they bend over a cliff, so you can walk down walls and onto the
underside of the world.

## Art direction
- **Hayden Clay suburbia** (the reference renders): velvet lawns (real shell-rendered fur,
  on cliff walls too), pastel pink houses with slate roofs, white pickets, a red mower, pink
  blossom, misty pits that fall away into teal fog, floating motes.
- **McGloughlin Brothers**: the island edges are *strata-cut* earth (layered cake bands);
  level transitions are digi-cut slices; a **zoetrope** in the last cul-de-sac animates
  only because *you* orbit the camera; repeated, receding suburbs on the horizon.
- **Beach House, *7***: the underside of the world is a black-and-white, stretchy,
  warping op-art night. Only red survives down there (the balloon, the mower).
- Orthographic diorama camera, ACES tone mapping, bloom, grain, vignette, soft tilt-shift.

## The three houses
1. **No. 1, Front Walk** (morning). Tutorial. A street with a hole in it, a pink house
   sunk on a pillar in a pit, and the house itself exploded into slices. Three alignments,
   each harder to find: street chunks, then the house rising out of the pit (a depth
   collapse), then the facade at eye level.
2. **No. 2, Mow Day** (noon). The lawn is too tall to walk through. Kick the driverless
   mower: it drives until something stops it and carves a walkable stripe. It also drives
   *down walls, across a sunken garden and back up the other side*. Goal: put the mower away
   in the garage across the gap, then follow it in. A floating strip of lawn has to be docked
   (an alignment) for the final run. Five kicks; `node tools/solve2.mjs` proves the layout is
   solvable and that the strip is required. Undo is always available.
3. **No. 3, Underside** (dusk → night). A blossom street on a slab of land with a second,
   upside-down black-and-white street hanging beneath it. Assemble the road folding over the
   edge, walk down it, and the camera rolls with you. A bridge over the canal can be
   re-seen: look straight down through the gap from either side and it moves to your side.

## Controls
| | Keyboard + mouse | PS5 controller |
|---|---|---|
| Walk | WASD / click a tile | Left stick / D-pad |
| Look around | Drag (left or right button), arrow keys | Right stick |
| Zoom | Mouse wheel, `-` `=` | L2 / R2 |
| Interact | Space / Enter | ✕ |
| Undo | Z / Backspace | □ |
| Hint | H | △ |
| Restart level | R (hold) | Create (hold) |
| Pause | Esc / P | Options |
