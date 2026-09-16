"""contentgate — pre-deploy guards for content sites.

Stdlib only. Every guard ships negative tests, and the suite runs before any
verdict is reported, so a broken guard fails loudly instead of passing quietly.
"""

__version__ = "0.1.0"

from . import guards, selftest, htmltext

__all__ = ["guards", "selftest", "htmltext", "__version__"]
