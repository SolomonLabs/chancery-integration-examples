#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

SCRIPT_DIRECTORY = Path(__file__).resolve().parent
REPOSITORY_ROOT = SCRIPT_DIRECTORY.parent


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonicalize(value: object) -> object:
    if isinstance(value, list):
        return [canonicalize(item) for item in value]
    if isinstance(value, dict):
        def key_order(key: str) -> tuple[int, int | str]:
            if key.isdigit() and str(int(key)) == key and int(key) < 4_294_967_295:
                return (0, int(key))
            return (1, key)

        return {
            key: canonicalize(value[key])
            for key in sorted(value, key=key_order)
        }
    return value


def canonical_hash(value: object) -> str:
    encoded = json.dumps(
        canonicalize(value),
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return sha256(encoded)


def entry_count(value: object) -> int:
    if isinstance(value, (dict, list)):
        return len(value)
    return 0


def require_equal(label: str, actual: object, expected: object) -> None:
    if actual != expected:
        raise RuntimeError(f"{label} mismatch: expected {expected}, received {actual}")


def calculate_source_tree(source_root: Path) -> tuple[str, int]:
    fixed_files = (
        source_root / "Cargo.lock",
        source_root / "Cargo.toml",
        source_root / "programs/chancery/Cargo.toml",
    )
    source_directory = source_root / "programs/chancery/src"
    source_files = tuple(path for path in source_directory.rglob("*") if path.is_file())
    files = sorted(
        (*fixed_files, *source_files),
        key=lambda path: path.relative_to(source_root).as_posix(),
    )
    manifest = bytearray()
    for path in files:
        relative_path = path.relative_to(source_root).as_posix()
        manifest.extend(f"{sha256(path.read_bytes())}  {relative_path}\n".encode("utf-8"))
    return sha256(bytes(manifest)), len(files)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path)
    arguments = parser.parse_args()

    compatibility = json.loads((REPOSITORY_ROOT / "BUILD-COMPATIBILITY.json").read_text("utf-8"))
    schema_bytes = (REPOSITORY_ROOT / "typescript/chancery.schema.json").read_bytes()
    python_schema_bytes = (REPOSITORY_ROOT / "python/chancery_reference/chancery.schema.json").read_bytes()
    if schema_bytes != python_schema_bytes:
        raise RuntimeError("TypeScript and Python Chancery schemas differ")
    schema = json.loads(schema_bytes)

    require_equal("program id", schema["program"]["address"], compatibility["program"]["programId"])
    require_equal("schema sha256", sha256(schema_bytes), compatibility["schema"]["sha256"])
    for field, schema_field in (
        ("wireSha256", "wire"),
        ("knownPdasSha256", "known_pdas"),
        ("instructionsSha256", "instructions"),
        ("accountsSha256", "accounts"),
        ("eventsSha256", "events"),
        ("typesSha256", "types"),
        ("constantsSha256", "constants"),
        ("errorsSha256", "errors"),
    ):
        require_equal(field, canonical_hash(schema[schema_field]), compatibility["schema"][field])
    for field, schema_field in (
        ("instructionCount", "instructions"),
        ("accountCount", "accounts"),
        ("eventCount", "events"),
        ("typeCount", "types"),
        ("constantCount", "constants"),
        ("errorCount", "errors"),
    ):
        require_equal(field, entry_count(schema[schema_field]), compatibility["schema"][field])

    source_binding_path = REPOSITORY_ROOT / compatibility["programSource"]["bindingPath"]
    source_binding_bytes = source_binding_path.read_bytes()
    require_equal(
        "source binding sha256",
        sha256(source_binding_bytes),
        compatibility["programSource"]["bindingSha256"],
    )
    source_binding_lines = [line for line in source_binding_bytes.decode("utf-8").splitlines() if line]
    if len(source_binding_lines) != 2:
        raise RuntimeError("Chancery program source binding is invalid")
    tree_hash, tree_separator, tree_label = source_binding_lines[0].partition("  ")
    count_value, count_separator, count_label = source_binding_lines[1].partition("  ")
    if (
        tree_separator == ""
        or tree_label != "chancery-program-source"
        or len(tree_hash) != 64
        or count_separator == ""
        or count_label != "files"
        or not count_value.isdecimal()
    ):
        raise RuntimeError("Chancery program source binding is invalid")
    require_equal("source tree sha256", tree_hash, compatibility["programSource"]["treeSha256"])
    require_equal("source file count", int(count_value), compatibility["programSource"]["fileCount"])

    source_verified = False
    if arguments.source_root is not None:
        observed_tree_hash, observed_file_count = calculate_source_tree(arguments.source_root.resolve())
        require_equal(
            "source tree sha256",
            observed_tree_hash,
            compatibility["programSource"]["treeSha256"],
        )
        require_equal(
            "source file count",
            observed_file_count,
            compatibility["programSource"]["fileCount"],
        )
        source_verified = True

    print(json.dumps({
        "programId": compatibility["program"]["programId"],
        "schemaSha256": compatibility["schema"]["sha256"],
        "sourceTreeSha256": compatibility["programSource"]["treeSha256"],
        "sourceVerified": source_verified,
    }, indent=2))


if __name__ == "__main__":
    main()
