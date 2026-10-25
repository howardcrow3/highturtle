A status chip states what an app is, in one word, with a dot. It is a `p` or `span` with class `status`.

**Variants.** `status` alone is a hollow ring (Planned). `status status-testing` and `status status-live` fill the dot with `accent` (In testing, Live).

**You provide** the literal status word in sentence case. Keep statuses true: "Planned" until something exists, "In testing" while it is not for sale, "Live" only when the app opens. Do not imply an app is available before it is.

**States.** None. A chip is not interactive.

**Do** keep the word beside the dot every time. The gold dot is 1.9:1 on `paper`, so it never carries the meaning alone. The hollow ring uses `border-control` (3.3:1).
**Do not** use red or green, add a third state color, or put the dot without the word.
