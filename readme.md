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

1. Drop a photo onto the canvas, or right-click the canvas and choose **Import images to canvas…**. The first layer becomes the unmasked base. Further imports can be moved, resized and rotated.
2. Drop reference images on the editor, or choose **Add images to collection…** from the canvas context menu. Every image in the collection – imports, generations and snapshots alike – receives a stable positive number as soon as it is added. Deleting an item does not renumber the others or reuse its number.
3. Move the generation frame to the region you want to edit. Corner handles preserve its ratio. Edge handles snap between ratios advertised by the selected model. Handles appear when the pointer touches the frame. While the canvas has no layers, the frame can be neither moved nor scaled; dragging inside it pans the view instead.
4. Write a prompt and press the yellow button, or press **Ctrl+Enter**. A generation captures its input images, prompt, model settings and frame before the request is sent. Moving the frame while it runs cannot change where the result lands.
5. New layers start with a 100% area and no feather, and they are not selected automatically. Click the mask thumbnail next to a layer’s image thumbnail to enter mask edit mode, which hides the generation frame and provides **Area**, **Feather**, roundness and mask translation. Selecting the image thumbnail shows only image-related controls: **Opacity**, **Brightness**, **Contrast**, **Gamma**, **Saturation**, **Vibrance** and **White balance** sliders (double-click one to reset it) and, for generations, **Content-aware alignment**. Dragging inside the selected layer repositions its mask; clicking the mask thumbnail again or pressing Escape leaves the mode.
6. Continue with further local edits, then right-click the frame view (tile 0 of the collection) and choose **Export…** for PNG, JPG, WebP or a PNG clipboard copy. Use **Save project** for an editable `.layerpaint` backup containing the source assets and request captures.

### The generate button and the frame toggle

The yellow button names what the generation will do with the canvas:

| Label | Situation |
| --- | --- |
| **Generate** | The frame does not touch any canvas content. |
| **Extend** | The frame contains canvas content but also empty canvas. |
| **Patch** | The frame is filled with canvas content and there is more content outside of it. |
| **Transform** | The frame is filled with canvas content and nothing lies outside of it. |

The frame icon next to it switches the frame off and on. While it is off, the frame is hidden and every generation spans all visible canvas content, padded to the closest aspect ratio the model supports. Hovering the button previews that area. **Frame it** and **Frame all artwork** switch the frame back on.

### Prompt references

```markdown
Please put ![1] onto the head of ![0]
```

`![0]` is the visible, masked canvas content inside the frame. It is automatically sent first whenever that frame contains artwork, including when other references are explicit:

```markdown
The hand should hold a cup of coffee with ![2] printed on it
```

A reference can carry a description in parentheses. The description is written into the prompt directly before the image:

```markdown
Please add ![2](this witch) to the image
```

is sent as “Please add this witch [Image 2] to the image”. Parentheses inside the description may be nested or escaped with a backslash. Something that looks like an image location – a URL, a path, a file name like `logo.png` or `<…>` – keeps its standard Markdown meaning and is never fetched.

Prompts without an explicit reference work as well, for local edits or global restyling:

```markdown
Please put a ring on the finger of ![0]
```

```markdown
Please restyle this to be a beautiful artistic oil painting
```

When framing a local edit, leave some padding around the subject so the model sees style, lighting and proportions.

Only referenced ingredients are sent. Repeated references share an attachment. Missing references, empty prompts, reference limits and explicit `![0]` on an empty frame fail before provider dispatch. Escaped references, code spans and complete standard Markdown image syntax remain literal; they do not trigger arbitrary URL fetching. HTML comments are omitted from generation prompts.

### Canvas and layers

The frame and the images have separate geometry. Generated layers remain pinned to their captured frame. To reuse generated pixels as a movable object, drag the generation’s thumbnail from the collection onto the canvas to place a new imported copy.

Use the **Image** tool to drag imports, resize from a corner or rotate from the round handle. The inspector also provides numerical transform fields. Shift snaps rotation to 15-degree increments; Alt resizes around the center.

Right-click the canvas, a layer or a row in the layer inspector for **Frame it**, **Hide layer**, ordering, deletion, framing, zoom, import, snapshot and undo/redo actions. There is no permanent floating canvas toolbar. Double-clicking a layer also frames it. Hidden layers keep a crossed-out eye button in their row to show them again quickly.

**Reroll** in the context menu of a generated layer sends its request again: the same prompt and the very same input images that were captured for it, but the currently selected model, resolution and quality. The result becomes another revision of that layer instead of a new layer, and its row reads “generation ‹ 2/3 ›” – the triangles cycle through the revisions. Every revision keeps its own request capture and collection number; mask, adjustments and opacity belong to the layer. Switching revisions is a single undo step.

The collection below the editor is a row-wrapping strip of equally tall thumbnails, each tagged with its number. Position 0 is a live view of `![0]` – the canvas inside the frame, or the generation area while the frame is off – which updates as the frame or the artwork changes. It can be clicked or dragged into the prompt like any other tile, but not removed or placed on the canvas. Thumbnails keep the image’s aspect ratio between 2:3 and 2:1; taller or wider images are cropped, which tiny arrows on the cropped edges indicate. Click a thumbnail to insert its reference at the cursor, drag it into the editor to insert the reference where you drop it, or drag it onto the canvas to place a movable copy there. The badge color tells the kind apart: pink for imports, green for generations and orange for canvas snapshots (**Snapshot the frame into collection** in the canvas context menu). `![0]` always refers to the live canvas inside the frame; its tile is a view, not a stored collection item.

Hovering a tile shows a tooltip above it with its name, kind, size and usage. While a tile is hovered, its references in the prompt light up, the layers that use it are outlined on the canvas and their thumbnails are highlighted in the layers panel – or their revision selector, if the image is a revision that is not shown right now. A cropped thumbnail unrolls in place to show the complete picture.

Right-click a tile for **Export** and **Delete**. A collection image downloads with its original bytes, unchanged. Deleting removes it from the collection only; layers that show it keep their pixels. The frame view opens the raster export dialog described below, preset to the frame region.

### Masks and outpainting

Area measures rectangular area: **25% means half the width and half the height**, before corner rounding. Mask position and image position are independent.

Feathering blends where the layer overlaps existing visual coverage. Exposed outpainting edges stay opaque instead of fading away. Enable **Feather exposed edges too** only when that behavior is deliberately desired.

The feather algorithm can be chosen with the `?feather_method=` URL parameter:

| Value | Behavior |
| --- | --- |
| `smooth` (default) | The ramp follows nested rounded rectangles whose corners round off toward the center, so corners show no diagonal crease and there is no ridge along the center line. Straight edges keep exactly the requested feather width. The quintic ramp avoids visible bands where it starts and ends. Where the artwork below a layer ends inside its feather band, the layer turns opaque in a smooth wedge toward that edge, so the edge does not show through as a hard line. |
| `distance` | The original ramp: smoothstep over the exact distance to the mask edge. |

Hovering or selecting a layer reveals its image bounds. Contracted masks add a second outline, and feathering adds an inner transition outline. Viewport rendering, generation inputs, snapshots, clipboard operations and raster exports use the same compositor.

### Export resolution

**Preserve the highest local detail** considers every relevant layer, including small high-resolution patches. It does not ignore a repair merely because the repair covers a small fraction of the canvas.

The export dialog – opened through **Export…** in the frame view’s context menu – can export the frame or all visible artwork. It also provides canvas-scale and custom-scale modes. It displays dimensions and megapixels before export. When full detail exceeds 64 megapixels or a 16,384-pixel edge, the app requires an explicit smaller scale/frame or permission to reduce the output. It does not silently discard local detail.

A portable project preserves editable normalized assets, geometry, masks, references and original request/output captures. Raster exports are flattened. This edition does not claim to vectorize generated images.

### Storage and recovery

The workspace autosaves to IndexedDB using atomic image/document transactions. Failed recovery pauses autosave rather than overwriting recoverable data. The UI prevents editing during initial recovery. **New** explicitly clears the document, references, prompt and history; it offers a save-copy option first. **Open** and project-file drops validate and decode the incoming project before replacing state.

Imported asset IDs are remapped, so another project cannot accidentally reuse a cached image under the same ID. Changes made while a slow import is preparing are protected. Credentials and endpoint settings are excluded from project files. Autosave is origin-specific: portable backups are the reliable way to move between origins or browsers.

## Models and provider transport

The app uses the dedicated OpenRouter Image API:

- Discovery: `/api/v1/images/models`
- Generation: `/api/v1/images`

`reference/image-models.json` records the dated capability snapshot. The client and gateway refresh capabilities at runtime and keep the snapshot as an explicit offline fallback. All nine requested canonical model IDs are present in the catalog. Nano Banana 2.1 is the default:

```text
google/gemini-3.1-flash-lite-image
google/gemini-3.1-flash-image
google/gemini-nano-banana-2.1
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
| Show frame (or generation area while the frame is off) / all artwork | F / Shift+F |
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

Image models can recompose or shift a subject. **Content-aware alignment** in a generated layer’s controls registers its output onto the canvas it was generated from. It is off by default because geometric registration can misinterpret legitimate edits, and it only moves content when it finds a reliable match. The first activation analyzes the images in a background worker; the result is stored with the layer, so later toggles are instant and survive reloads and portable projects. The layer’s world rectangle and the raw provider output never change; realigned content is clipped to the captured frame.

Color adjustments are non-destructive. They are rendered with a WebGL 2 shader (with an identical CPU fallback) and apply to the viewport, generation inputs, snapshots and exports alike. Cancellation prevents a late layer from being added, but a provider may still bill work already performed.

The Monacozen module-worker packaging fix is retained as a version-specific Bun patch. Remove it only after an upstream replacement passes both production and development browser tests.
