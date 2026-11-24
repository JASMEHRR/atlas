# Implementation Prompt — `izanami-ritual-dark`

Paste into any coding agent. Vendor-agnostic; no framework assumed.
This is a **design language**, not a layout to reproduce. Apply it to your own
content, structure and product.

---

You are building **[PURPOSE]**. Implement it in the following design language.

## Register

Reverent, slow, cinematic. The visitor should feel they have slowed down before
they have read a single word. Restraint in the type is what makes the imagery
feel expensive.

> **Read this first.** This is a **photography-led** language. Large, well-graded
> images carry all the emotion; the type system is austere so it never competes.
> With stock or low-quality imagery it collapses into an empty template. If you
> do not have real photography, choose a different design language.

## Non-negotiables

**1. Achromatic interface. Chromatic photography.**

```
--ground: #0a0801   /* warm near-black — R>G>B, never pure #000 */
--ink:    #d9d7d4   /* warm off-white — never pure #fff */
```

The interface has exactly two values and no accent. Hierarchy comes from scale,
space and opacity steps of `--ink` only.

All colour lives in the photography, graded to one narrow low-key range —
desaturated sage and moss, wet stone, warm sand, ochre lamplight in deep shadow.
Nothing brightens past mid-tone, which is what lets a two-colour type system
survive on top of it. Contrast is ≈15.6:1 (AAA).

Before you start: decide where error, success, focus and disabled states live.
A two-colour palette has nowhere obvious to put them, and retrofitting is what
breaks this language in practice.

**2. Inverted leading contrast — the signature.**

- Display type: `line-height: 1.0`. Exactly 1.0.
- Body type: `line-height: 2.05` to `2.46`.

Do not compromise toward a middle value. Tight display makes stacked headline
fragments read as one carved mass; open body makes prose feel meditative. The
gap between them is the entire effect.

**3. Four type families, zero role overlap.**

| Family | Job | Sizes |
|---|---|---|
| Cinzel | eyebrow labels, section tags | 13–19px |
| Playfair Display | display headlines | 38–48px |
| Shippori Mincho | body prose | 15–19px |
| Satoshi | UI, buttons, functional | 14–16px |

`letter-spacing: normal` throughout. No tracking tricks.

**4. Staircase headlines.** Break display lines manually into 2–4 words *and
indent each successive line further right*, roughly 3ch per step:

```
Sharing
    the Japanese Spirit
        of Harmony
```

At 1.0 leading this cascade reads as inscribed rather than typeset. It is the
most recognisable move in the language — a left-stacked block is not the same thing.

**4b. Images break the grid; type never does.** Photography overlaps, bleeds and
sits off-grid at mixed scales — a portrait crop layered over a landscape plate,
depth created by overlap rather than shadow. The text column stays rigid
throughout. That tension is the composition.

**4c. Asymmetric split.** Text occupies roughly the left 45%, imagery the right
(or reversed). Never centred.

**4d. Photographic interludes.** Between major sections, give a full viewport to
a single image with no text at all. This is not wasted space — it is what makes
the next headline land.

**5. Ambient motion slower than attention.** Any looping background movement runs
**100 seconds**, linear, infinite. Under ~20s it becomes a distracting effect
rather than a living surface.

**6. Vertical sticky section labels.** Each section's eyebrow label is rotated to
run bottom-to-top along the left edge (`writing-mode: vertical-rl` +
`rotate(180deg)`) and pinned at `top: 189px` while the section scrolls past. This
replaces a persistent nav. Never put text here a user must read quickly, and give
it a sensible accessible name.

**7. Generous vertical scale.** Expect 10–14 viewport-heights total, with few
sections and large gaps. Only do this if you have real content — with thin
content it reads as padding.

## Section template — repeat it exactly

```
[vertical sticky label]        Cinzel 19px, rotated, left edge
[staircase display headline]   Playfair Display 48px / 1.0, indented cascade
[body paragraph]               Shippori Mincho 15px / 2.05, max 46ch
[text-swap link]               Cinzel 17px, thin rule extending left
        ↳ paired with a layered image group on the opposite side
[full-bleed photographic interlude]   between major sections
```

Do not vary it between sections. The rhythm comes from *not* varying.

## Components

**Text-swap link** — duplicate the label in markup; on hover the first copy
slides up and out while the second slides in from below. `0.4s linear`.

**Numbered entry** — small numeral (`01`, `02`, `03`) set low-left, paired with a
one-word Playfair title, a two-line promise, and one body paragraph. Nothing else.

**Layered image pair** — a landscape plate with an offset portrait crop
overlapping it at a different scale. Depth from overlap, never from shadow.

**Footer** — a long horizontal rule running into a large Playfair section name;
Cinzel small-caps nav; office addresses; **live ticking clocks for each office
timezone**; a `TOP` return at right. The live clocks are cheap to build and a
disproportionately strong signal of a real operation.

**Stacked sticky panels** — consecutive `position: sticky; top: 0` full-height
panels that stack over one another as the user scrolls.

**Numeric preloader** *(only if this is a brand/narrative site)* — a `0 → 100`
counter in the lower-left, scroll locked until complete, headline revealing
progressively behind it.

> **This must have a timeout.** The reference implementation gates on asset
> loading with no fallback; when an asset stalls, the counter sits at 0 and the
> page never appears. Cap it at ~4s and release regardless.

## Motion stack

- Smooth scroll: **Lenis** (or equivalent) — required; native scroll breaks the pacing
- Page transitions: **Swup** or equivalent — optional but on-language
- UI transitions: `0.4s linear` for ritual feel. Use
  `cubic-bezier(0.22, 1, 0.36, 1)` instead for anything genuinely interactive,
  where linear reads as cheap.
- `will-change: transform` on ambient layers only
- WebGL background layers are **optional** — the language holds without them

## Accessibility — required, not optional

- Full `prefers-reduced-motion` path: **skip the preloader entirely** (don't
  fast-forward it), disable ambient loops, disable smooth-scroll interception.
- Scroll-jacking must never trap keyboard users — verify tab order still reaches
  every section.
- Body text at 15px needs the wide leading and short measure to stay readable;
  if you tighten one, raise the size.

## Do not

- Gate a utility product or dashboard behind a ceremonial preloader
- Keep 2.4× leading for dense, scannable, or data-heavy content
- Set Cinzel (Roman capitals) as body copy
- Use pure `#000` or `#fff` anywhere
- Add an accent colour "just for CTAs"

## Deliverable

Semantic HTML, modern CSS (custom properties, `svh`, `text-wrap: balance`),
progressive enhancement. Use `izanami-ritual-dark.tokens.css` as the token layer.
