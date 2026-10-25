An app card is one entry in the catalog: a plate on `surface` with film-frame corner marks, the app name, a status, a one-sentence description and, when the app is live, one action.

**Structure.** `ul.apps > li.app-card` holding an `h3` (Cormorant, the app name), a `p.status`, a `p` description and an optional `div.action` with a `btn btn-small`. An app with a download adds a `form.dl-form` after the description.

**You provide** the app name as people would say it ("Spec checker"), the status word and one plain sentence that says what the app does and for whom. No marketing adjectives.

**States.** The card does not move on hover. Its corners are 20px marks at a 12px inset in `frame`, drawn as eight gradients in the card background. They are decoration only and carry no meaning.

**Do** lay cards in a grid of `minmax(20rem, 1fr)` with a `space-lg` gap.
**Do not** add a shadow or a radius, put a photograph or icon in the card, or tint it. The film-frame corners are the one motif the system carries from Grains.
