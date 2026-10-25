A text field collects one value, here an email address. It is an `input` inside `form.dl-form`, with its own label above it.

**Structure.** `label` (Inter, 11px, uppercase, 0.3em tracking, `ink`), then `input[type=email]` (Inter 15px, square corners, 1px `border-control`, `paper` ground), then a `p.form-status` for the result.

**You provide** a noun label ("Email address"), a placeholder that shows the shape of a valid value ("you@company.com") and a status message that says what happened.

**States.** Focus draws the 2px `focus-ring` outline at a 4px offset. An error sets `form-status` to `is-error`, colored `danger` (6.5:1 on `paper`), and always carries words. A success uses `is-ok` in `ink`.

**Do** write errors that say what went wrong and what to do: "That address does not look right. Check it and try again."
**Do not** use `line` for the border (it fails 3:1), rely on color alone, or apologize.
