# manchas-noise-monitor

Classroom noise monitor featuring Manchas, the Jaguar.

## Running locally

```
./serve.sh
```

This serves the app at http://localhost:8000 and opens it in your browser. Pass a port to use a different one (`./serve.sh 3000`). Serving it, rather than opening `index.html` directly, is required for the 3D classroom: browsers block loading the 3D model from a `file://` page, and the flat classroom picture is shown instead.

## Editing the 3D classroom in Blender

The 3D classroom is shown when **3D scenes** is switched on under Settings → Background. With it off, the app uses the flat background images and the flat Manchas.

The room, furniture and props live in `backgrounds/3D/classroom.glb`, together with their textures. `classroom3d.js` loads it and adds the cartoon look and the animated parts (drifting clouds, swaying lamps, spinning globe, dust, sunlight patches and lights).

1. In Blender, start an empty scene (delete the default cube, camera and light), then **File → Import → glTF 2.0** and pick `backgrounds/3D/classroom.glb`.
2. Move, resize, recolor or add objects. Colors are each material's **Base Color**; textures are the images plugged into it.
3. **File → Export → glTF 2.0**, choose the **glTF Binary (.glb)** format and overwrite `backgrounds/3D/classroom.glb`. The default export settings work (keep **+Y Up** on).
4. Reload the app (`./serve.sh`) to see the changes.

Blender will look less cartoony than the app: toon shading and outlines are applied when the model loads. Any cameras or lights exported from Blender are ignored, because the app sets up its own.

Object names drive a few behaviours, so keep these names (Blender's `.001` suffixes are fine):

| Name starts with | What the app does |
| --- | --- |
| `Lamp_` | Sways the object around its origin and adds the glow and light at its `LampBulb` |
| `GlobeSphere` | Spins it around its own axis |
| `MascotSpot` | Manchas sits on the floor at this object's position (add an Empty with this name to move him; without one he sits at the front of the rug) |
| `WindowGlass` | Replaces its material with the drifting-cloud sky and adds a sunlight patch on the floor in front of it |
| `LampBulb`, `WindowGlass` | Unlit (always fully bright) |
| `ChalkboardFace` | Smooth shading instead of toon bands, so the chalk art stays clean |

Every object gets a dark outline except those whose names start with `Floor`, `Ceiling`, `Rug`, `WindowGlass`, `ChalkboardFace`, `ShelfBack`, `GlobeStem`, `GlobeSphere`, `GlobeRing`, `LampCord`, `LampShade`, `LampBulb`, `Paper`, `StickyNote` or `CupPencil`. Walls, floor, ceiling, windows, lamps and the rug don't cast shadows. To change these lists, edit `NO_OUTLINE`, `NO_SHADOW_CAST`, `UNLIT` and `SMOOTH_SHADED` at the top of `classroom3d.js`.
