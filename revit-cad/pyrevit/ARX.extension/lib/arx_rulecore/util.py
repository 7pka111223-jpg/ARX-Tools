"""Small helpers ported 1:1 from the PDF tool's src/util.js so behaviour is
identical across hosts."""

# Characters that are special inside a regex; mirrors the JS character class
# /[.*+?^${}()|[\]\\-]/ used by escapeRegex in src/util.js.
_REGEX_SPECIAL = set(".*+?^${}()|[]\\-")


def escape_regex(value):
    """Escape regex metacharacters in ``value`` (port of src/util.js escapeRegex)."""
    return "".join("\\" + c if c in _REGEX_SPECIAL else c for c in str(value))


_HTML_MAP = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}


def escape_html(value):
    """Escape HTML-significant characters (port of src/util.js escapeHtml)."""
    return "".join(_HTML_MAP.get(c, c) for c in str(value))
