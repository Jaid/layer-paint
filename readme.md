# LayerPaint

A non-destructive image studio for building illustrations through local edits, references, inpainting, outpainting and global restyling. The prompt editor is Monacozen; the workspace is an infinite canvas with independently editable layers.

## Run

```powershell
cd C:/Users/jaid/git/layer-paint
bun install --frozen-lockfile
bun run dev
```

The development launcher starts Vite and a same-origin, loopback Image API gateway. Follow the local URL printed in the terminal.

For a production build:

```powershell
bun run build
bun run start
```

The production server defaults to `http://127.0.0.1:3000`. Both servers are intended for personal, local use. `HOST`, `PORT` and an explicitly trusted `PUBLIC_ORIGIN` can be configured, but the bundled server is **not** an authenticated multi-user service. Put authentication, HTTPS and usage limits in front of a publicly reachable deployment. Do not expose the development server publicly.

### Credentials

Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`. No credentials were copied from the Mage candidates. Use a fresh key rather than one previously exposed in a published bundle.

The supplied key remains in the Bun server. Neither a Vite environment prefix nor a compile-time replacement exposes it to JavaScript. The browser receives only a configuration flag and a local anti-CSRF token. A production build is scanned for the supplied key and recognizable OpenRouter key literals.

For a static deployment, the key popover accepts a browser-session key. This key stays in memory, is sent directly to OpenRouter, and is forgotten on reload. It is never included in portable projects or autosaves.

**Demo mode requires no key and spends no credits.** It creates an explicitly labeled procedural illustration, or applies a procedural treatment to the captured canvas. It is not represented as an AI response. The mode survives reload and New project so a no-credit session does not silently become a paid one.

## Editing workflow

1. Drop a photo onto the canvas, or choose **Imports → To canvas**. The first layer becomes the unmasked base. Further imports can be moved, resized and rotated.
2. Drop reference images on the editor, or choose **Imports → To prompt**. Each receives a stable positive reference number. Deleting an ingredient does not renumber the others or reuse its number.
3. Move the generation frame to the region you want to edit. Corner handles preserve its ratio. Edge handles snap between ratios advertised by the selected model. Handles appear when the pointer touches the frame.
4. Write a prompt and choose **Generate**, or press **Ctrl+Enter**. A generation captures its input images, prompt, model settings and frame before the request is sent. Moving the frame while it runs cannot change where the result lands.
5. Use the docked layer inspector to adjust **Area** and **Feather**. Advanced mask mode hides the generation frame and provides mask translation and roundness. Dragging inside the selected layer repositions its mask.
6. Continue with further local edits, then use **Export** for PNG, JPG, WebP or a PNG clipboard copy. Use **Save project** for an editable `.layerpaint` backup containing the source assets and request captures.

### Prompt references

```markdown
Please put ![1] onto the head of ![0]
```

`![0]` is the visible, masked canvas content inside the frame. It is automatically sent first whenever that frame contains artwork, including when other references are explicit:

```markdown
The hand should hold a cup of coffee with ![2] printed on it
```

Only referenced ingredients are sent. Repeated references share an attachment. Missing references, empty prompts, reference limits and explicit `![0]` on an empty frame fail before provider dispatch. Escaped references, code spans and complete standard Markdown image syntax remain literal; they do not trigger arbitrary URL fetching. HTML comments are omitted from generation prompts.

### Canvas and layers

The frame and the images have separate geometry. Generated layers remain pinned to their captured frame. To reuse generated pixels as a movable object, add them to the prompt collection and explicitly place a new imported copy onto the canvas.

Use the **Image** tool to drag imports, resize from a corner or rotate from the round handle. The inspector also provides numerical transform fields. Shift snaps rotation to 15-degree increments; Alt resizes around the center.

Right-click the canvas or a layer for **Frame it**, visibility, ordering, deletion, framing and zoom actions. There is no permanent floating canvas toolbar. Double-clicking a layer also frames it.

The collection distinguishes four kinds of content:

| Kind | Meaning |
| --- | --- |
| Canvas — yellow | Live contents of the current frame; `![0]` |
| Canvas snapshot — orange | A frozen, reusable frame capture |
| Import — pink | An imported source, usable on the canvas or in the prompt |
| Generation — green | Generated pixels, optionally reusable as references |

### Masks and outpainting

Area measures rectangular area: **25% means half the width and half the height**, before corner rounding. Mask position and image position are independent.

Feathering blends where the layer overlaps existing visual coverage. Exposed outpainting edges stay opaque instead of fading away. Enable **Feather exposed edges too** only when that behavior is deliberately desired.

Hovering or selecting a layer reveals its image bounds. Contracted masks add a second outline, and feathering adds an inner transition outline. Viewport rendering, generation inputs, snapshots, clipboard operations and raster exports use the same compositor.

### Export resolution

**Preserve the highest local detail** considers every relevant layer, including small high-resolution patches. It does not ignore a repair merely because the repair covers a small fraction of the canvas.

The export dialog also provides canvas-scale and custom-scale modes. It displays dimensions and megapixels before export. When full detail exceeds 64 megapixels or a 16,384-pixel edge, the app requires an explicit smaller scale/frame or permission to reduce the output. It does not silently discard local detail.

A portable project preserves editable normalized assets, geometry, masks, references and original request/output captures. Raster exports are flattened. This edition does not claim to vectorize generated images.

### Storage and recovery

The workspace autosaves to IndexedDB using atomic image/document transactions. Failed recovery pauses autosave rather than overwriting recoverable data. The UI prevents editing during initial recovery. **New** explicitly clears the document, references, prompt and history; it offers a save-copy option first. **Open** and project-file drops validate and decode the incoming project before replacing state.

Imported asset IDs are remapped, so another project cannot accidentally reuse a cached image under the same ID. Changes made while a slow import is preparing are protected. Credentials and endpoint settings are excluded from project files. Autosave is origin-specific: portable backups are the reliable way to move between origins or browsers.

## Models and provider transport

The app uses the dedicated OpenRouter Image API:

- Discovery: `/api/v1/images/models`
- Generation: `/api/v1/images`

`reference/image-models.json` records the dated capability snapshot. The client and gateway refresh capabilities at runtime and keep the snapshot as an explicit offline fallback. All eight requested canonical model IDs are present in the catalog:

```text
google/gemini-3.1-flash-lite-image
google/gemini-3.1-flash-image
openai/gpt-image-2.5-sunburst
black-forest-labs/flux-3-image
x-ai/grok-imagine-image-2.0
bytedance-seed/seedream-5-0-flash
bytedance-seed/seedream-5-0-lite
bytedance-seed/seedream-5-0-pro
```

The two original shorthand IDs are accepted as aliases. The general chat catalog is not used to decide image-model availability. Account access, credits, prices and actual rendering quality remain provider/account properties, not guarantees made by a dropdown.

The gateway validates model capabilities and embedded PNG/JPEG/WebP references, rebuilds an allowlisted request, limits concurrent requests to two and retains each slot until its response body finishes. It does not forward arbitrary provider options, fetch user-supplied remote image URLs, or reflect provider error bodies.

## Keyboard controls

| Action | Shortcut |
| --- | --- |
| Generate | Ctrl+Enter / Cmd+Enter |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z; Cmd equivalents |
| Frame / Image / Mask tool | V / I / M |
| Show frame / all artwork | F / Shift+F |
| Pan | Space+drag or middle-button drag |
| Zoom | Wheel; + / − |
| Pan with wheel | Shift+wheel, or horizontal trackpad scrolling |
| Nudge active frame, image or mask | Arrow keys; Shift for larger steps |
| Disable magnetic snapping | Hold Shift during a frame/image move |
| Delete selection | Delete / Backspace outside text fields |
| Exit mask mode | Escape |
| Context-menu keyboard navigation | Arrow keys, Home, End, Escape |

## Verification

```powershell
bun run lint
bun run test
bun run build
bun run test-browser
bun run test-browser --development
```

`bun run check` runs type checking, unit/component tests, the production build and the production browser suite. Set `CHROME_PATH` when Chrome is not in a standard location. Tests use a temporary browser profile; they do not access your normal Chrome profile.

Browser checks include real PNG/SVG/JXL imports without experimental JXL browser flags, zero-delay Monaco typing, frame ratio snapping, imported-image transforms, cancellation, request capture, generated-layer locking, mask pixel invariants, native-detail raster exports, PNG clipboard write/read, portable projects, autosave recovery and responsive dark/light layouts.

Provider responses in the repeatable browser suite are deterministic mocks. Running the suite does not spend OpenRouter credits. A real, paid generation smoke test is intentionally separate and requires your configured account.

Test logs and screenshots are written under `out/test/`. Implementation provenance and design decisions are documented in `IMPLEMENTATION.md`.

## Boundaries

This is an 8-bit browser-raster workflow, not an archival HDR or full color-management pipeline. Accepted PNG/JPEG/WebP source bytes are retained; other supported imports are normalized to WebP. JPEG XL uses a local, lazy WebAssembly worker. Image-size and export-size limits protect the browser; large documents and undo history still require substantial memory.

Image models can recompose or shift a subject. **Experimental drift correction** is available but off by default because geometric registration can misinterpret legitimate edits. It never moves the generated layer's world rectangle, and the raw provider output remains available in the project. Cancellation prevents a late layer from being added, but a provider may still bill work already performed.

The Monacozen module-worker packaging fix is retained as a version-specific Bun patch. Remove it only after an upstream replacement passes both production and development browser tests.
