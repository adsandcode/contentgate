"""Configuration loading. JSON, no dependencies, no magic."""

import json
import pathlib

DEFAULTS = {
    "root": ".",
    "scope": None,
    "exclude_classes": [],
    "guards": {},
}

TEMPLATE = {
    "root": ".",
    "scope": ["article", "post"],
    "exclude_classes": ["cta"],
    "guards": {
        "keywords": {
            "enabled": True,
            "table": "content/keywords.json",
            "page_for_slug": "site/blog/{slug}/index.html",
            "primary_min_hits": 3
        },
        "internal_links": {
            "enabled": True,
            "pages": "site/blog/*/index.html",
            "money_paths": ["/services/", "/pricing/"],
            "require_figure": True,
            "extra_evidence": []
        },
        "translation": {
            "enabled": True,
            "source_dir": "content/blog",
            "locales": ["en"],
            "same_script_locales": [],
            "native": "content/blog/_native.json"
        },
        "claims": {
            "enabled": False,
            "pages": "site/**/*.html"
        },
        "lastmod": {
            "enabled": True,
            "pages": "site/**/index.html",
            "state": ".contentgate-lastmod.json",
            "strip_classes": [],
            "strip_patterns": [],
            "bulk_change_threshold": 0.3
        }
    }
}


class Config(dict):
    def __init__(self, data, path=None):
        super().__init__(data)
        self.path = pathlib.Path(path) if path else None
        self.root = (self.path.parent if self.path else pathlib.Path(".")) / data.get("root", ".")
        self.root = self.root.resolve()

    @property
    def scope(self):
        s = self.get("scope")
        return tuple(s) if s else None

    @property
    def exclude_classes(self):
        return tuple(self.get("exclude_classes", ()))

    def guard(self, name):
        return self.get("guards", {}).get(name, {})

    def enabled(self, name):
        return bool(self.guard(name).get("enabled"))

    def resolve(self, relative):
        return (self.root / relative).resolve()


def load(path):
    p = pathlib.Path(path)
    if not p.exists():
        raise FileNotFoundError(
            "no config at {}. Run `contentgate init` to write a starting point.".format(p))
    data = dict(DEFAULTS)
    data.update(json.loads(p.read_text(encoding="utf-8")))
    return Config(data, p)


def write_template(path):
    p = pathlib.Path(path)
    if p.exists():
        raise FileExistsError("{} already exists; not overwriting".format(p))
    p.write_text(json.dumps(TEMPLATE, indent=2) + "\n", encoding="utf-8")
    return p
