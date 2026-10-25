Buttons start the one action a page is about. The primary button is an ink fill with square corners and at most one sits in a view.

**Variants.** `btn` is the primary action ("See the apps"). Add `btn-small` inside a card or a form. `link` is the quiet second action beside it ("Visit High Turtle"): ink text with a gold underline.

**You provide** a verb-first label as the element's own text. Set it in sentence case: the stylesheet makes it uppercase with 0.3em tracking, so write "See the apps", not "SEE THE APPS".

**States.** Hover turns a primary button from `ink` to `accent` with `on-accent` text. Keyboard focus is a 2px `focus-ring` outline at a 4px offset. A link thickens its underline from 2px to 3px.

**Do** keep one `btn` per view and keep the label the same through a flow ("Email me the download", then "Sent").
**Do not** round the corners, add a shadow, use gold as a text color, or set button text in Cormorant. Buttons and labels are always Inter.
