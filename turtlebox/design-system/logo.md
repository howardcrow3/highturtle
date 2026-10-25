# Logo

The Turtlebox logo is a smiling turtle with the word Turtlebox set in Inter Medium. It is a single ink. The files are in `assets/Logo`, in ink and reversed. The wordmark is drawn from the font as outlines, so it renders the same everywhere.

## Lockups

- **Horizontal** (`logo-horizontal`): the turtle left, the name right, 12px apart at the header size. This is the default for headers, footers and email signatures.
- **Stacked** (`logo-stacked`): the turtle centred above the name. Use on a cover, a poster or any square or tall space.
- **Mark** (`mark`): the turtle alone. Use for an avatar, an app icon or wherever the name already appears.
- **Wordmark** (`wordmark`): the name alone. Use it only beside a mark that is already present.

## Color

- On `paper` or `surface`, use the ink version, filled with `ink`.
- On `ink`, use the reversed version, filled with `on-ink`.
- Never any other color, gradient or outline. In code, inline the SVG and set its `fill` from the role token, so both themes follow.

## Clear space and size

- Keep clear space equal to the height of the turtle's shell on every side. Nothing else enters that area.
- Minimum widths: horizontal 120px, stacked 96px, mark 24px. Below the horizontal minimum, switch to the mark.
- In the site header the mark is 32px high and the wordmark 26px, 24px on a phone.

## Icons and social

- `assets/Icons/app-icon-light.svg` and `app-icon-dark.svg` set the mark at 62% of a square for app stores. Stores apply their own mask. `app-icon-rounded.svg` shows the 22% corner for previews only.
- `assets/Icons/favicon.svg` has a transparent ground and follows the color scheme. `apple-touch-icon.png` is 180px on ivory.
- `assets/Social/og.png` is 1200 by 630: the logo, the headline and the domain on ivory with a hairline frame.

## Do not

- Stretch, squash, skew or rotate it.
- Recolor it, outline it or add a shadow.
- Redraw it or retype the name in another font.
- Put it on a busy photograph or any surface where it holds less than 4.5:1.
- Place the Grains Granule mark next to it as if the two were one brand.
