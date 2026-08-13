# Models

## `counsel-suit.glb` — the counsel on slide 10

The rigged, animated figure who walks across the stage on `concept-lawyer-tycoon`
and hauls `pov-graded-question` into frame. Loaded by
[`src/scenes/counsel-model.ts`](../../src/scenes/counsel-model.ts).

| | |
| --- | --- |
| Source | Quaternius, **Ultimate Modular Men Pack** (February 2022) — <https://quaternius.com/packs/ultimatemodularcharacters.html>, mirrored at <https://poly.pizza/bundle/Ultimate-Modular-Men-Pack-ZiH8muWqwQ> |
| Character | the suited businessman, glTF binary |
| Licence | **CC0 1.0 Universal** (public domain dedication) |
| Attribution | not required — see <https://quaternius.com/faq.html>: *"these assets can be used for free without the need for attribution in commercial, educational, and personal projects. All models are under the CC0 License."* |
| Size on disk | 957 KB (980,260 bytes) |
| Geometry | 6,634 triangles, 4 meshes, 62 bones |
| Textures | **none.** Eight flat materials named `Suit`, `White`, `Tie`, `Skin`, `Hair`, `Eyebrows`, `Eye`, `Black` |
| Clips kept | `Idle`, `Idle_Neutral`, `Walk`, `Run_Back`, `Interact` |

CC0 was the requirement, not a preference. This deck goes in front of investors,
so an asset whose terms cannot be stated exactly is not usable at any quality —
which is what ruled out Mixamo, whose licence covers use of the animation data
but not redistribution of it as a file in a repository.

### What was changed from the original

**Pruned from 24 clips to 5.** The pack ships every character with the full
animation set — jumps, punches, deaths, a wave. Five are used here and the other
nineteen were about a third of the file. `scripts/` has no tool for this because
it was a one-off: the GLB's `animations` array was filtered and its accessors,
buffer views and buffer re-packed to drop the orphaned keyframe data.
1,494 KB → 957 KB.

Nothing else was touched. Colours are applied at load time from
`STAGE_COUNSEL_LOOK` rather than baked, which is why the file has no textures and
why the counsel comes out in the deck's own navy and auburn instead of the
pack's default palette.

### Why this one

The three obvious alternatives were the three.js example characters — `Soldier`,
`Xbot`, `RobotExpressive` — which are MIT, well rigged, and all wrong: a soldier
in fatigues, a grey mannequin and a cartoon robot, none of which can be dressed
as counsel in a legal-tech pitch. This model arrives already wearing a suit and
tie, and because every surface is a flat named material rather than an atlas
texture, the deck's palette can be written straight onto it.

The two properties that made it work mechanically are less obvious and matter
more: it has a real `Walk` cycle whose planted foot can be measured for stride
(see `measureStride` in `counsel-model.ts`), and it has a `Run_Back` — a
backpedal, feet forward and body going the other way — which is exactly the clip
a man hauling a sheet of paper across a stage needs and which almost no free
pack includes.
