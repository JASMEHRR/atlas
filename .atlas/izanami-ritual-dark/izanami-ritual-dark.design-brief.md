# Izanami — Ritual Dark Editorial

**Slug:** `izanami-ritual-dark`
**Source:** https://izanami-official.com/ (captured 2026-08-08, viewport 1536px)
**Evidence:** `measured` — computed styles and DOM read from the live page;
composition verified by scrolling the rendered page section by section.
**Design DNA:** reverent, cinematic, photographic, typographically severe

> **Revision note.** A first pass read only computed styles and concluded "two
> colours, no imagery, no accent." Scrolling the rendered page proved that wrong:
> photography is the primary visual material. Computed-style extraction alone
> cannot see composition. Recorded here because it is the main lesson for Atlas.

---

## Why this works

It is a **photography site with a typographic overlay**, not a dark minimal site.
Large architectural and natural imagery carries all the emotion; the type system
is deliberately austere so it never competes. The restraint in the type is what
lets the images feel expensive.

Two ideas do most of the work:

1. **Inverted leading contrast.** Display type at exactly 1.0 line-height; body at
   2.0–2.46. Headlines become dense carved blocks, prose becomes meditative air.
2. **The image breaks the grid, the type never does.** Photography overlaps,
   bleeds and layers freely. Text stays on a rigid column. The tension between a
   disciplined text grid and a loose image grid is the whole composition.

---

## Colour

**Type/UI palette — measured, two values only:**

| Role | Value | Notes |
|---|---|---|
| Ground | `#0A0801` | warm near-black, R>G>B. Never pure `#000` |
| Ink | `#D9D7D4` | warm off-white. Never pure `#FFF` |

Contrast ≈ **15.6:1** (AAA). There is no accent token, no hover colour, no
semantic colour anywhere in the interface.

**Photographic palette — observed, and this is where the colour actually lives:**

- misty sage and moss green (forest through glass)
- wet stone and pale gravel
- warm sand and raked earth
- ochre lamplight against deep shadow (incense interior)

Everything is desaturated and low-key, so imagery sits *inside* the near-black
ground rather than punching out of it. The photography never brightens past
mid-tone, which is why a two-colour type system survives on top of it.

**The transferable rule:** keep the interface achromatic, let photography supply
every hue, and grade all photography to one narrow tonal range.

---

## Typography — measured

| Family | Role | Sizes |
|---|---|---|
| **Cinzel** (Roman capitals) | eyebrow labels, nav, footer, metadata | 13 / 15 / 17 / 19px |
| **Playfair Display** | display headlines | 19 / 38 / 48px |
| **Shippori Mincho** | body prose | 15 / 19px |
| **Satoshi** | functional UI | webfont-loaded |

**Leading — the signature:**

- Display: `line-height: 1.0` (48px on a 48px line; 38px on 38.4px)
- Body: `line-height: 2.05–2.46` (15px on a 30.7px or 36.9px line)

`letter-spacing: normal` everywhere. Cinzel's own Roman proportions do the work
that letterspaced sans usually fakes.

**Staircase headlines.** Display lines are broken manually *and progressively
indented*, cascading right:

```
Sharing
    the Japanese Spirit
        of Harmony
```

Not a left-stacked block — a diagonal. Combined with 1.0 leading this reads as
carved or inscribed. It is the single most recognisable move on the page.

---

## Layout & space

- **9603px tall at 1536px wide ≈ 13.8 viewport-heights.** Few sections, enormous gaps.
- **Asymmetric split:** text column occupies roughly the left 45%; imagery holds
  the right. Reversed in places, never centred.
- **Overlapping image panels.** A portrait crop sits on top of a landscape plate,
  offset off-grid, at a different scale. Depth via overlap, not shadow.
- **Full-bleed photographic interludes.** Entire viewports of image with no text
  at all, used as breathing room between sections. Roughly one per major section.
- **9 sticky elements**; three `.stickySection` panels stack in sequence.
- Persistent header: logo top-left, `EN / JA` and `MENU` top-right, each marked
  with a small dot indicator above.

**Vertical section labels.** The eyebrow label (`PHILOSOPHY`, `PROJECTS`) is
rotated to run bottom-to-top along the left edge and pinned sticky while its
section scrolls past. It replaces a persistent nav and reinforces the Japanese
typographic reference without using Japanese text.

---

## Motion — measured

| Property | Value |
|---|---|
| Smooth scroll | **Lenis** (`html.lenis`) |
| Page transitions | **Swup** (`html.swup-enabled`) |
| Ambient animation | `cloudMove01` / `cloudMove02`, **100s linear infinite** |
| UI transition | `0.4s linear` |
| GPU hints | `will-change: transform` |
| WebGL | 2 `<canvas>` layers |
| Clip-path reveals | 3 elements |

**The preloader is a designed component.** A `0 → 100` counter lower-left,
`html.-wait` + `lenis-stopped` freezing scroll, hero headline revealing behind it.

**100-second ambient loops** are the detail most worth stealing. At that duration
motion sits below conscious notice — the page feels alive rather than animated.
Anything under ~20s reads as an effect.

*Inferred, not observed:* per-word headline reveals, scroll-triggered entrances,
and a two-copy hover swap on links (each link label appears twice in the DOM —
the standard structure for a slide-up text exchange). See the caveat below.

---

## Components

**Vertical sticky label** — Cinzel 19px, rotated, pinned at the left edge.

**Staircase display headline** — Playfair Display 48px / 1.0, progressive indent.

**Body block** — Shippori Mincho 15px / 2.05+, short measure, each line visibly
separated.

**Layered image pair** — landscape plate with an offset portrait crop overlapping it.

**Photographic interlude** — one full viewport of image, zero text.

**Numbered project entry** — `01` / `02` / `03` set small and low-left, paired
with a one-word Playfair title, a two-line promise, and a body paragraph.

**Text-swap link** — label duplicated in the DOM, thin rule extending to its left.

**Footer** — a long horizontal rule running into a large Playfair section name;
Cinzel small-caps nav; two office addresses; **live ticking clocks for Dubai
(GST) and Tokyo (JST)**; `TOP` return at right. The live clocks are a small,
cheap, disproportionately effective signal of a real global operation.

---

## Design philosophy — portable

1. **Achromatic interface, chromatic photography.** Grade every image to one
   narrow tonal range and let it carry all the colour.
2. **Invert the leading contrast.** Tight display, open body.
3. **Let images break the grid; never let type break it.**
4. **Ambient motion slower than attention.** 100s, not 10s.
5. **Give the eye somewhere to rest.** A full screen of pure image is not wasted
   space; it is what makes the next headline land.
6. **Repeat the section template exactly.** Rhythm comes from not varying.
7. **Warm your blacks and whites.** `#0A0801` and `#D9D7D4`, never `#000`/`#FFF`.

---

## Anti-patterns — do not carry over

- **This language collapses without photography budget.** It is a delivery system
  for exceptional imagery. With stock photography it reads as an empty template.
  This is the single biggest risk in reusing it.
- **Don't gate a utility product behind a 0→100 preloader.** Fine for a brand
  narrative; hostile on a dashboard or tool.
- **Don't keep 2.4× leading for dense or scannable content.** Built for three
  sentences per screen, not documentation.
- **Don't set Cinzel as body copy.** Roman capitals collapse at small sizes.
- **Don't rotate labels containing anything a user must read quickly.**
- **13.8 screens needs real content**, or it reads as padding.
- **A two-colour palette has no room for state.** Decide where error, success,
  focus and disabled live *before* building.
- **`transition: linear`** suits this ritual register but reads as cheap on
  conventional interactive UI — use an eased curve there.

---

## Implementation notes

- **Difficulty: high** — not the CSS, the art direction. Typography and tokens are
  straightforward; sourcing and grading the imagery is the actual project.
- Lenis and Swup are small and framework-agnostic. The WebGL layers are optional;
  the language holds without them.
- **Accessibility:** contrast is excellent, but the scroll-jacked entrance and
  permanent loops need a `prefers-reduced-motion` path that skips the preloader
  entirely rather than fast-forwarding it. Rotated text needs a sensible
  accessible name.
- Fonts: Cinzel, Playfair Display, Shippori Mincho are Google Fonts (SIL OFL);
  Satoshi is Fontshare. No paid licences required.
- **Give the preloader a hard timeout (~4s).** The live site's counter is driven
  by `requestAnimationFrame` and gates on WebGL readiness with no fallback — in a
  throttled or WebGL-less context the counter sits at 0 and the page never
  appears at all. This was reproduced during capture.

---

## Capture caveat

`requestAnimationFrame` was frozen in the capture environment, so the preloader
never completed and no animation could be observed running. Composition above was
verified by forcing reveal end-states and scrolling. Everything in the Motion
table is read from CSS and library detection, which is reliable; the specific
easing and choreography of scroll-triggered reveals is **inferred**.
