Turtlebox builds small AI apps that each do one job. The brand is Grains-derived: warm neutrals, one gold accent, Cormorant Garamond for the voice and Inter for everything you read and press. It should feel quiet, exact and unhurried, like a well-set page with a smiling turtle on it.

## Principles

- Warm neutrals only. Every surface is ivory, warm white or charcoal. No pure white, no cool greys, no added hues. The one exception is `danger`, for errors.
- One accent. `accent` (gold) marks underlines, filled status dots and the hover fill of the primary button. It is 1.9:1 on `paper`, so it is never text and never carries meaning alone.
- Borders, not shadows. Separate things with a 1px `line` rule or a `surface` plate. No drop shadows, no gradients, no rounded corners.
- Inter for reading, Cormorant for the voice. Headings and the wordmark are Cormorant. Body copy, ledes, buttons, labels and forms are Inter. This departs from Grains, which sets body copy in Cormorant Light.
- Say what it is. Name an app by what it does and write copy as `voice.md` describes. No AI-generated imagery.

## Color

- Page ground is `paper`. Cards and panels are `surface`.
- Headings, the wordmark and the primary button are `ink`. Running text is `body`. Never set body copy in `ink`.
- The primary button is an `ink` fill with `on-ink` text. On hover it turns `accent` with `on-accent` text.
- Rules and card borders are `line`. The border of an input is `border-control`, because a control boundary needs 3:1 and `line` does not reach it.
- Errors use `danger` and always come with words.
- Both themes are first class. Light is `ivory` on `charcoal` ink. Dark swaps the roles through the same names, so write components against role names and never hex values. Dark follows `prefers-color-scheme`. Set `data-theme="light"` or `"dark"` on the root to force one.
- Every text pair in `tokens.json` records its measured contrast. Text holds 4.5:1 and meaningful non-text holds 3:1 in both themes.

## Type

- Display and headings use Cormorant Garamond: `display` (Light 300, 56 to 96px) once per page, `page-title`, `heading` and `title` (Regular 400). `wordmark` (Semibold 600) is used only for the name.
- Everything else uses Inter: `lede`, `body`, `body-sm` (Light 300), `fine`, `field`, `message` (Regular or Medium) and the uppercase `label` and `button` styles (11px, 0.3em tracking).
- Write sentence case in headings and in the text of buttons and labels. The stylesheet sets labels in uppercase for you.
- Keep running text near 34em wide, left aligned and ragged right.
- Both fonts are SIL Open Font License and ship as woff2 files in `fonts/`. Self-host them.

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

- `tokens.json` is the only source of values. `python3 build.py` writes `tokens.css`, `dist/tailwind.preset.js` and `dist/TurtleboxTokens.swift`, and rebuilds `../assets/styles.css` for the site. `python3 build_assets.py` regenerates the logos, icons and social image.
- Components are plain CSS in `components/bundle.css`. Each component folder says which classes to use and what it expects.
- Read `logo.md` for clear space and misuse, and `voice.md` for tone and real copy.

## Origin

Turtlebox borrows the Grains design language (`howardcrow3/grains`, `docs/brand/`) on purpose, so the two products feel related. It keeps its own turtle mark, its own components and its own voice. The Granule mark is Grains' and is not used here.
