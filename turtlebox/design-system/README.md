> **2026-11-28: the sites now run on the Turtlebox UI web layer.** `ui/` is a vendored copy of `dist/` from howardcrow3/turtlebox-ui (`web-light.css` and `fonts/`; see that repo's `docs/WEB.md`). `build.py` and `build_highturtle.py` build both sites' `styles.css` from `ui/web-light.css` + `compat.css` (+ `sites/highturtle.css`). Both sites are light only. To update, rebuild in turtlebox-ui (`python3 scripts/build-tokens.py && python3 scripts/build-web.py`), copy its `dist/` here as `ui/`, then run `python3 build.py` and `CSS_ONLY=1 python3 build_highturtle.py`. The rules below (square corners, uppercase labels, Inter Light) describe the earlier marketing system and are superseded where they differ; `tokens.json` and `components/` still feed the Tailwind and Swift outputs only.

Turtlebox builds small AI apps that each do one job. The brand is Grains-derived: warm neutrals, one gold accent, Inter, and only Inter, for everything you read and press. It should feel quiet, exact and unhurried, like a well-set page with a smiling turtle on it.

## Principles

- Warm neutrals only. Every surface is ivory, warm white or charcoal. No pure white, no cool greys, no added hues. The one exception is `danger`, for errors.
- One accent. `accent` (gold) marks underlines, filled status dots and the hover fill of the primary button. It is 1.9:1 on `paper`, so it is never text and never carries meaning alone.
- Borders, not shadows. Separate things with a 1px `line` rule or a `surface` plate. No drop shadows, no gradients, no rounded corners.
- One family, no serifs. Everything is Inter: Light for headings and body, Regular and Medium for UI, Medium for the wordmark.
- Say what it is. Name an app by what it does and write copy as `voice.md` describes. No AI-generated imagery.

## Color

- Page ground is `paper`. Cards and panels are `surface`.
- Headings, the wordmark and the primary button are `ink`. Running text is `body`. Never set body copy in `ink`.
- The primary button is an `ink` fill with `on-ink` text. On hover it turns `accent` with `on-accent` text.
- Rules and card borders are `line`. The border of an input is `border-control`, because a control boundary needs 3:1 and `line` does not reach it.
- Errors use `danger` and always come with words.
- Both themes are defined. Light is `ivory` on `charcoal` ink. Dark swaps the roles through the same names, so write components against role names and never hex values. Dark follows `prefers-color-scheme`. Set `data-theme="light"` or `"dark"` on the root to force one. Today highturtle.com follows the visitor's setting and turtlebox.studio forces light.
- Every text pair in `tokens.json` records its measured contrast. Text holds 4.5:1 and meaningful non-text holds 3:1 in both themes.

## Type

- Display and headings use Inter: `display` (Light 300, 48 to 80px) once per page, `page-title`, `heading` and `title` (Regular 400). `wordmark` (Medium 500) is used only for the name.
- Everything else is also Inter: `lede`, `body`, `body-sm` (Light 300), `fine`, `field`, `message` (Regular or Medium) and the uppercase `label` and `button` styles (11px, 0.3em tracking).
- Write sentence case in headings and in the text of buttons and labels. The stylesheet sets labels in uppercase for you.
- Keep running text near 34em wide, left aligned and ragged right.
- Inter is SIL Open Font License and ships as woff2 files in `fonts/`. Self-host it.

## Spacing and shape

- Space comes from `space-xs` to `space-3xl`, an 8px base: 8, 16, 24, 32, 48, 64, 96. Gutter is `space-sm`. Cards pad with `space-xl`. Sections breathe with `space-2xl` on a phone and `space-3xl` on desktop.
- Corners are square (`radius-none`). Status dots are `radius-round`. The app icon uses `radius-app-icon`.
- The one decorative motif is the film-frame corner: four 20px marks in `frame` at the corners of an app card.

## Motion and focus

- Transitions are `duration-base` (300ms) with the one `ease-out` curve. Nothing bounces. `prefers-reduced-motion` removes all of it.
- Keyboard focus is a 2px solid `focus-ring` outline at a 4px offset on every interactive element. It is never removed.

## Iconography and imagery

- There is no icon set. The brand mark is the turtle, in `assets/Logo`. Use plain text everywhere else.
- No emoji, no stock imagery, no AI-generated images.

## Using the system

- `tokens.json` is the only source of values. `python3 build.py` writes `tokens.css`, `dist/tailwind.preset.js` and `dist/TurtleboxTokens.swift`, and rebuilds `../assets/styles.css` for the site. `python3 build_assets.py` regenerates the logos, icons and social image, `python3 build_colorways.py` the palette colorways in `assets/Logo/colorways`, and `python3 build_logo_pngs.py` the PNG exports in `assets/Logo/png` and `assets/Logo/colorways/png`. Wordmarks are set in Inter Medium.
- Components are plain CSS in `components/bundle.css`. Each component folder says which classes to use and what it expects.
- Read `logo.md` for clear space and misuse, and `voice.md` for tone and real copy.

## Origin

Turtlebox borrows the Grains design language (`howardcrow3/grains`, `docs/brand/`) on purpose, so the two products feel related. It keeps its own turtle mark, its own components and its own voice. The Granule mark is Grains' and is not used here.

## Sites on this system

- turtlebox.studio builds from `turtlebox/build.py` and `assets/styles.css`, generated by `build.py`.
- highturtle.com uses the same tokens and components. `python3 build_highturtle.py` writes its stylesheet, fonts, logos, favicon and social image from `components/bundle.css` and `sites/highturtle.css`. The site file holds the home page's portfolio table, company details, signup band and header tightening for small phones. Edit it there, not in `assets/styles.css`, which is overwritten.
- The `design-system/` folder is excluded from both deploys.

## Where it lives

- Repo: `turtlebox/design-system/` on branch `grains-design-prototype` of `howardcrow3/highturtle`.
- Design System artifact: https://claude.ai/artifact/Wmu4iwBcjEh7T7E6pdrcZY
