The site header holds the turtle mark, the wordmark and the main navigation. It sticks to the top and sits on a 92% `paper` wash over a 1px `line` rule.

**Structure.** `header.site-header > div.wrap.bar` containing `a.brand` (the mark at 32px high, then the wordmark in Inter Medium 26px) and a `nav` of links.

**You provide** two or three short nav labels in sentence case. The stylesheet sets them in Inter, uppercase and tracked. The current page gets `aria-current="page"`, which draws the gold underline.

**States.** Hover and current both draw a 1px `accent` underline. Below 860px the nav tightens to 0.18em tracking and never wraps.

**Do** use the wordmark exactly as `logo.md` describes. Keep to the mark plus the name.
**Do not** add a search box, a menu of more than three links, or a second button.
