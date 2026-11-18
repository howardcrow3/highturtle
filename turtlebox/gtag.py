"""Google tag for turtlebox.studio, exactly as Google Analytics gives it. Every Turtlebox page carries it
first in <head>: turtlebox/build.py, backer/build.py and legal/build.py add it through add_tag()."""

GTAG = """<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-TZCX2QL8"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
</script>"""


def add_tag(html):
    """Put the Google tag first in <head>, once."""
    if "GTM-TZCX2QL8" in html or "<head>" not in html:
        return html
    return html.replace("<head>", "<head>\n" + GTAG, 1)
