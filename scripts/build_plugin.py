#!/usr/bin/env python3
"""Validate and package Nexscope's portable plugin using Python stdlib."""

import argparse
import hashlib
from io import BytesIO
import json
import os
import re
import shutil
import unicodedata
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "plugin.json",
    "mcp.json",
    "skills/nexscope/SKILL.md",
    "skills/nexscope/references/legacy-cli.md",
    "runtime/nexscope_cli-0.1.1-py3-none-any.whl",
    "assets/icon.png",
    "README.md",
    "LICENSE",
    "ui/workflow/v1.html",
)
UI_FILES = ("ui/workflow/v1.html",)
MAX_UI_BYTES = 256 * 1024
PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
MCP_URL = "https://api.nexscope.ai/api/skill-api/v2/mcp"
WHEEL = "runtime/nexscope_cli-0.1.1-py3-none-any.whl"
WHEEL_SHA256 = "3ebceff81566b0f276fbaa0e4fc533300edc5b52950c950be3d34e897c64a4e6"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def https_url(value):
    parsed = urlparse(value) if isinstance(value, str) else None
    return bool(parsed and parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password)


def safe_path(path, root=None):
    require(".." not in path.parts, f"Unsafe path: {path}")
    require(not any(part.is_symlink() for part in (path, *path.parents)), f"Linked path: {path}")
    if root is not None:
        require(path.resolve().is_relative_to(root.resolve()), f"Path escapes root: {path}")
    return path


def validate():
    for name in FILES:
        path = safe_path(ROOT / name, ROOT)
        require(path.is_file() and not path.is_symlink(), f"Missing or linked package file: {name}")
        require(path.resolve().is_relative_to(ROOT), f"Package file escapes root: {name}")
        parts = PurePosixPath(name).parts
        require(not PurePosixPath(name).is_absolute() and ".." not in parts, f"Unsafe ZIP path: {name}")

    plugin = json.loads((ROOT / "plugin.json").read_text(encoding="utf-8"))
    mcp = json.loads((ROOT / "mcp.json").read_text(encoding="utf-8"))
    require(set(plugin) <= {"$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"}, "Unknown portable manifest field")
    require(plugin.get("$schema") == PLUGIN_SCHEMA, "Wrong plugin schema")
    require(plugin.get("name") == "codex-nexscope-mcp-plugin", "Wrong plugin identity")
    require(re.fullmatch(r"\d+\.\d+\.\d+", plugin.get("version", "")), "Invalid version")
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    require(plugin["version"] == package.get("version") == lock.get("version") == lock.get("packages", {}).get("", {}).get("version"), "Plugin, package, and lock versions differ")
    require(isinstance(plugin.get("description"), str) and plugin["description"].strip(), "Missing description")
    require(plugin.get("license") == "LicenseRef-Proprietary", "License metadata mismatch")
    require("repository" not in plugin or https_url(plugin["repository"]), "Repository must be a real HTTPS URL")
    require(https_url(plugin.get("homepage")), "Invalid homepage")
    author = plugin.get("author", {})
    require(author.get("name") == "Nexscope" and https_url(author.get("url")), "Invalid author")
    extension = plugin.get("extensions", {}).get("com.openai", {})
    require(extension.get("onboardingSkill") == "./skills/nexscope/SKILL.md", "Invalid onboarding Skill path")
    interface = extension.get("interface", {})
    for field in ("displayName", "shortDescription", "longDescription", "developerName", "category"):
        require(isinstance(interface.get(field), str) and interface[field].strip(), f"Missing {field}")
    for field, limit in (("displayName", 30), ("shortDescription", 30), ("longDescription", 4000), ("developerName", 80)):
        value = interface[field]
        require(len(value) <= limit and (field == "longDescription" or "\n" not in value), f"Invalid {field} length or line break")
    for field in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"):
        require(https_url(interface.get(field)), f"Invalid {field}")
    for field in ("composerIcon", "logo"):
        require(interface.get(field) == "./assets/icon.png", f"Invalid {field} path")
    require(interface.get("capabilities") == ["Interactive", "Read", "Write"], "Invalid interface capabilities")
    prompts = interface.get("defaultPrompt", [])
    require(isinstance(prompts, list) and 1 <= len(prompts) <= 3, "Expected one to three starter prompts")
    require(all(isinstance(p, str) and p.strip() and len(p) <= 128 and "\n" not in p and "@" not in p and "nexscope_" not in p for p in prompts), "Starter prompts must be short, natural, single-line user requests")
    require(len({unicodedata.normalize("NFKC", " ".join(p.split())).casefold() for p in prompts}) == len(prompts), "Duplicate starter prompts")
    require("apps" not in extension, "App references are not accepted for directory submission")
    require(not (ROOT / ".app.json").exists(), "Source must remain portable without .app.json")

    require(set(mcp) == {"$schema", "mcpServers"} and mcp["$schema"] == MCP_SCHEMA, "Invalid MCP root")
    require(isinstance(mcp["mcpServers"], dict) and set(mcp["mcpServers"]) == {"nexscope"}, "Expected one Nexscope MCP server")
    server = mcp["mcpServers"]["nexscope"]
    require(server == {"type": "streamable-http", "url": MCP_URL} and https_url(server.get("url")), "Invalid remote MCP server or embedded credentials")

    skill = (ROOT / "skills/nexscope/SKILL.md").read_text(encoding="utf-8")
    header = re.match(r"\A---\n(.*?)\n---\n", skill, re.DOTALL)
    require(header is not None, "Missing Skill frontmatter")
    require(re.search(r"(?m)^name: nexscope$", header.group(1)), "Invalid Skill name")
    require(re.search(r"(?m)^description: \S", header.group(1)), "Missing Skill description")
    require("nexscope_route_api" in skill and "OAuth" in skill, "Skill missing MCP routing or auth guidance")
    wheel = (ROOT / WHEEL).read_bytes()
    require(len(wheel) == 2126420 and hashlib.sha256(wheel).hexdigest() == WHEEL_SHA256, "Legacy CLI wheel bytes differ")
    with ZipFile(ROOT / WHEEL) as archive:
        names = archive.namelist()
        require(archive.testzip() is None and len([name for name in names if name.startswith("nexscope_cli/") and not name.endswith("/")]) == 657, "Legacy CLI wheel contents differ")
        catalog = json.loads(archive.read("nexscope_cli/catalog.json"))
        skills = catalog.get("skills", {})
        require(len(skills) == 138 and sum(item.get("available") is True for item in skills.values()) == 136, "Legacy CLI catalog differs")

    icon = (ROOT / "assets/icon.png").read_bytes()
    require(icon.startswith(b"\x89PNG\r\n\x1a\n") and len(icon) <= 5 * 1024 * 1024, "Invalid icon")
    width = int.from_bytes(icon[16:20], "big")
    height = int.from_bytes(icon[20:24], "big")
    require(48 <= width == height <= 4096, "Icon must be square and 48-4096 pixels")
    for name in UI_FILES:
        ui = (ROOT / name).read_bytes()
        require(0 < len(ui) <= MAX_UI_BYTES, f"{name} must be nonempty and at most 256 KiB")
        html = ui.decode("utf-8")
        require("<!doctype html>" in html.lower() and "ui/initialize" in html, f"Invalid MCP Apps UI: {name}")
        require(not re.search(r"<(?:script|link|img|iframe)\b[^>]*(?:src|href)\s*=", html, re.IGNORECASE), f"UI must be self-contained: {name}")
    for name in ("plugin.json", "mcp.json", "skills/nexscope/SKILL.md", "README.md", "LICENSE", *UI_FILES):
        content = (ROOT / name).read_text(encoding="utf-8")
        require(not re.search(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|\bBearer [A-Za-z0-9._~-]{20,}\b", content), f"Possible embedded credential in {name}")
    for directory, subdirs, filenames in os.walk(ROOT):
        subdirs[:] = [name for name in subdirs if name not in {".git", "dist", "node_modules", "__pycache__"}]
        for name in filenames:
            if name.lower() in {".env", "credentials.json", "secrets.json", "id_rsa", "id_ed25519"}:
                raise ValueError(f"Credential file in source tree: {(Path(directory) / name).relative_to(ROOT)}")

    return plugin


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate without writing files")
    parser.add_argument("--backend-resources", type=Path, help="Assigned Java src/main/resources directory for exact UI copy/check")
    args = parser.parse_args()
    try:
        plugin = validate()
        if args.backend_resources is not None:
            resources = safe_path(args.backend_resources.absolute())
            require(resources.is_dir(), "Backend resources directory is missing")
            for name in UI_FILES:
                target = safe_path(resources / "mcp-apps" / name.removeprefix("ui/"), resources)
                if not args.check:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(ROOT / name, target)
                require(target.is_file() and target.read_bytes() == (ROOT / name).read_bytes(), f"Backend UI is missing or differs from source bytes: {name}")
        contents = {name: (ROOT / name).read_bytes() for name in FILES}
        destination = safe_path(ROOT / "dist" / f"{plugin['name']}-{plugin['version']}.zip", ROOT)
        target = BytesIO() if args.check else destination
        if not args.check:
            destination.parent.mkdir(exist_ok=True)
        with ZipFile(target, "w", ZIP_DEFLATED) as archive:
            for name, content in contents.items():
                archive.writestr(name, content)
        if args.check:
            target.seek(0)
        with ZipFile(target) as archive:
            require(archive.namelist() == list(contents) and archive.testzip() is None, "ZIP verification failed")
            require(all(archive.read(name) == content for name, content in contents.items()), "ZIP bytes differ from staged package")
        print("Package source and ZIP staging check passed")
        if not args.check:
            print(destination)
    except (ValueError, OSError, UnicodeError) as error:
        parser.exit(1, f"Package check failed: {error}\n")


if __name__ == "__main__":
    main()
