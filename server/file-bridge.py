# file-bridge.py - Lightweight local storage file manager bridge for Plenrip Audio (Python Flask)
import os
import re
import shutil
import unicodedata
from pathlib import Path
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "https://plenrip.planrift.me",
                "http://localhost:5500",
                "http://127.0.0.1:5500",
                "http://localhost:3001",
                "http://127.0.0.1:3001",
                "*",
            ],
            "allow_headers": ["Content-Type", "x-api-key", "X-API-Key"],
        }
    },
)

_script_dir = Path(__file__).resolve().parent
PROJECT_DIR = _script_dir.parent.resolve()

# Load .env if present (project root or script dir)
_env_candidates = [
    PROJECT_DIR / ".env",
    _script_dir / ".env",
    Path(".env").resolve(),
]
for _ep in _env_candidates:
    if _ep.exists():
        try:
            for line in _ep.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k and k not in os.environ:
                        os.environ[k] = v
        except Exception:
            pass
        break

PORT = int(os.environ.get("FILE_BRIDGE_PORT", 3001))
NAS_API_KEY = os.environ.get("NAS_API_KEY") or os.environ.get("FILE_BRIDGE_KEY") or ""
PLACEHOLDER_KEYS = {"your-secret-api-key-here", "change-me", "secret"}
if not NAS_API_KEY or NAS_API_KEY in PLACEHOLDER_KEYS:
    raise SystemExit(
        "ERROR: A real NAS API key is required. Set NAS_API_KEY to a long random value (not the placeholder). The bridge refuses to start without one."
    )

# Resolve storage root
if os.environ.get("STORAGE_DIR") or os.environ.get("NAS_ROOT"):
    STORAGE_DIR = Path(os.environ.get("STORAGE_DIR") or os.environ.get("NAS_ROOT")).resolve()
elif Path("G:/Server").exists():
    STORAGE_DIR = Path("G:/Server").resolve()
elif os.environ.get("ND_MUSICFOLDER"):
    STORAGE_DIR = Path(os.environ.get("ND_MUSICFOLDER")).resolve().parent
else:
    STORAGE_DIR = (PROJECT_DIR / "storage").resolve()

MUSIC_DIR = Path(os.environ.get("ND_MUSICFOLDER") or (STORAGE_DIR / "Music")).resolve()
TMP_CHUNKS_DIR = (STORAGE_DIR / ".tmp_chunks").resolve()

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
TMP_CHUNKS_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================================
# HARDCODED SECURITY BOUNDARY & PATH NORMALIZATION
# ============================================================================

def canonicalize_path(p: Path) -> str:
    s = str(p.resolve()).rstrip("/\\. ")
    return s.lower() if os.name == "nt" else s

CANONICAL_STORAGE_ROOT = canonicalize_path(STORAGE_DIR)
CANONICAL_MUSIC_ROOT = canonicalize_path(MUSIC_DIR)
CANONICAL_PROJECT_ROOT = canonicalize_path(PROJECT_DIR)
CANONICAL_SERVER_ROOT = canonicalize_path(_script_dir)
CANONICAL_TMP_ROOT = canonicalize_path(TMP_CHUNKS_DIR)

PROTECTED_CANONICAL_DIRS = {
    CANONICAL_STORAGE_ROOT,
    CANONICAL_MUSIC_ROOT,
    CANONICAL_PROJECT_ROOT,
    CANONICAL_SERVER_ROOT,
    CANONICAL_TMP_ROOT,
}

IGNORED_SYSTEM_NAMES = {
    ".ds_store",
    "__macosx",
    ".spotlight-v100",
    ".trashes",
    ".fseventsd",
    ".temporaryitems",
    ".volumeicon.icns",
    ".apdisk",
    "thumbs.db",
    "desktop.ini",
    ".directory",
}

WINDOWS_RESERVED_RE = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$", re.IGNORECASE)
ILLEGAL_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f\x7f]')
DOTS_ONLY_RE = re.compile(r"^\.+$")

def is_system_metadata_path(raw_path: str) -> bool:
    if not raw_path:
        return False
    norm = unicodedata.normalize("NFC", str(raw_path)).replace("\\", "/")
    for seg in norm.split("/"):
        clean = seg.strip()
        if not clean:
            continue
        lower = clean.lower()
        if lower in IGNORED_SYSTEM_NAMES or clean.startswith("._") or lower.startswith(".trash-"):
            return True
    return False

def sanitize_path_segment(raw_segment: str) -> str:
    if not raw_segment:
        return ""
    seg = unicodedata.normalize("NFC", str(raw_segment)).strip()
    if not seg or DOTS_ONLY_RE.match(seg):
        return ""
    seg = os.path.basename(seg.replace("\\", "/"))
    if not seg or DOTS_ONLY_RE.match(seg):
        return ""
    seg = ILLEGAL_CHARS_RE.sub("_", seg)
    seg = seg.rstrip(" .").lstrip(" ")
    if not seg or DOTS_ONLY_RE.match(seg):
        return ""
    if WINDOWS_RESERVED_RE.match(seg):
        seg = f"_{seg}"
    return seg

def normalize_upload_rel_path(raw_path: str, fallback_filename: str = "") -> str:
    inp = str(raw_path or "").strip() or str(fallback_filename or "").strip()
    if not inp or "\x00" in inp:
        raise ValueError("Invalid or empty upload file path")
    cleaned_inp = re.sub(r"^[a-zA-Z]:[\\/]+", "", unicodedata.normalize("NFC", inp)).replace("\\", "/")
    raw_segments = [
        s.strip()
        for s in cleaned_inp.split("/")
        if s.strip()
    ]
    if not raw_segments:
        raise ValueError("Upload path resolved to zero segments")
    safe_segments = []
    for raw_seg in raw_segments:
        if raw_seg == ".":
            continue
        if re.match(r"^\.{2,}$", raw_seg):
            raise PermissionError(f'Security boundary violation: illegal dot-segment "{raw_seg}"')
        clean_seg = sanitize_path_segment(raw_seg)
        if not clean_seg:
            raise PermissionError(f'Security boundary violation: invalid segment "{raw_seg}"')
        safe_segments.append(clean_seg)
    if not safe_segments:
        raise ValueError("Upload path contained no valid segments")
    return os.path.join(*safe_segments)

def safe_path(sub: str = "", forbid_root: bool = False, forbid_protected: bool = False) -> Path:
    raw_sub = unicodedata.normalize("NFC", str(sub or "")).strip()
    if "\x00" in raw_sub:
        raise PermissionError("Security boundary violation: null byte in path")

    raw_parts = [p for p in raw_sub.replace("\\", "/").split("/") if p]
    sanitized_parts = []
    for part in raw_parts:
        trimmed = part.strip()
        if trimmed == ".":
            continue
        if re.match(r"^\.{2,}$", trimmed) or not trimmed.rstrip(" ."):
            raise PermissionError(f'Security boundary violation: illegal segment "{trimmed}"')
        clean = sanitize_path_segment(trimmed)
        if not clean:
            raise PermissionError(f'Security boundary violation: invalid segment "{trimmed}"')
        sanitized_parts.append(clean)

    root = STORAGE_DIR.resolve()
    target = (root / os.path.join(*sanitized_parts)).resolve() if sanitized_parts else root
    canonical_target = canonicalize_path(target)

    if canonical_target != CANONICAL_STORAGE_ROOT and not canonical_target.startswith(CANONICAL_STORAGE_ROOT + os.sep):
        raise PermissionError(f'FATAL SECURITY BOUNDARY: Target "{target}" escapes storage root "{STORAGE_DIR}"')

    if (
        canonical_target == CANONICAL_SERVER_ROOT
        or canonical_target.startswith(CANONICAL_SERVER_ROOT + os.sep)
        or canonical_target == CANONICAL_TMP_ROOT
        or canonical_target.startswith(CANONICAL_TMP_ROOT + os.sep)
    ):
        raise PermissionError(f'FATAL SECURITY BOUNDARY: Access to application/internal directory "{target}" is forbidden')

    if not CANONICAL_STORAGE_ROOT.startswith(CANONICAL_PROJECT_ROOT + os.sep) and (
        canonical_target == CANONICAL_PROJECT_ROOT or canonical_target.startswith(CANONICAL_PROJECT_ROOT + os.sep)
    ):
        raise PermissionError(f'FATAL SECURITY BOUNDARY: Access to application/internal directory "{target}" is forbidden')

    if forbid_root and canonical_target == CANONICAL_STORAGE_ROOT:
        raise PermissionError(f'FATAL SECURITY BOUNDARY: Operation directly on root storage directory "{STORAGE_DIR}" is forbidden')

    if forbid_protected and canonical_target in PROTECTED_CANONICAL_DIRS:
        raise PermissionError(f'FATAL SECURITY BOUNDARY: Destructive or overwrite operation on protected root "{target}" is forbidden')

    return target

def assert_safe_file_write_target(final_target: Path, dest_dir: Path):
    canonical_target = canonicalize_path(final_target)
    canonical_dest = canonicalize_path(dest_dir)
    if canonical_target in PROTECTED_CANONICAL_DIRS:
        raise PermissionError(f'FATAL SECURITY BOUNDARY: Refusing to overwrite protected root directory "{final_target}"')
    if canonical_target == CANONICAL_STORAGE_ROOT or not canonical_target.startswith(CANONICAL_STORAGE_ROOT + os.sep):
        raise PermissionError(f'FATAL SECURITY BOUNDARY: Write target "{final_target}" is outside storage root')
    if canonical_target == canonical_dest or not canonical_target.startswith(canonical_dest + os.sep):
        raise PermissionError(f'FATAL SECURITY BOUNDARY: Write target "{final_target}" must sit strictly inside destination "{dest_dir}"')
    if final_target.exists() or final_target.is_symlink():
        if final_target.is_dir():
            raise PermissionError(f'FATAL SECURITY BOUNDARY: Target "{final_target}" is an existing directory; refusing to overwrite')
        if final_target.is_symlink():
            raise PermissionError(f'FATAL SECURITY BOUNDARY: Target "{final_target}" is a symbolic link; refusing to overwrite')

@app.before_request
def require_api_key_and_check_boundary():
    if request.method == "OPTIONS":
        return
    is_download = request.path == "/api/files/download"
    api_key = (
        request.headers.get("x-api-key")
        or request.headers.get("X-API-Key")
        or (
            request.args.get("apiKey") or request.args.get("key") or request.args.get("x-api-key")
            if is_download
            else None
        )
    )
    if not api_key or api_key != NAS_API_KEY:
        return (
            jsonify(
                {
                    "error": "Unauthorized: Invalid or missing API key (provide x-api-key header"
                    + (" or ?apiKey= parameter" if is_download else "")
                    + ")"
                }
            ),
            401,
        )

    # Pre-verify security boundary on all write/delete requests
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        try:
            body_data = request.get_json(silent=True) or {}
            raw_sub = request.args.get("path") or body_data.get("path") or ""
            is_delete = request.method == "DELETE" and request.path == "/api/files"
            safe_path(raw_sub, forbid_root=is_delete, forbid_protected=is_delete)
        except Exception as err:
            return jsonify({"error": str(err)}), 403

@app.route("/api/health", methods=["GET"])
@app.route("/api/files/health", methods=["GET"])
def bridge_health():
    return jsonify({"status": "ok", "service": "file-bridge", "storage": str(STORAGE_DIR), "music": str(MUSIC_DIR)})

@app.route("/api/files", methods=["GET"])
@app.route("/api/files/list", methods=["GET"])
def list_files():
    try:
        p = safe_path(request.args.get("path", ""))
        items = []
        for entry in os.scandir(p):
            if entry.name == ".tmp_chunks" or entry.name.lower() in IGNORED_SYSTEM_NAMES or entry.name.startswith("._"):
                continue
            try:
                stat = entry.stat()
                items.append(
                    {
                        "name": entry.name,
                        "isDirectory": entry.is_dir(),
                        "size": stat.st_size,
                        "mtime": stat.st_mtime * 1000,
                    }
                )
            except Exception:
                items.append({"name": entry.name, "isDirectory": entry.is_dir(), "size": 0, "mtime": 0})
        items.sort(key=lambda x: (not x["isDirectory"], x["name"].lower()))
        rel = "" if p == STORAGE_DIR else str(p.relative_to(STORAGE_DIR)).replace("\\", "/")
        return jsonify({"path": rel, "items": items})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/files/folder", methods=["POST"])
def create_folder():
    try:
        data = request.get_json(silent=True) or {}
        raw_name = str(data.get("name", "")).strip()
        if not raw_name or "/" in raw_name or "\\" in raw_name or DOTS_ONLY_RE.match(raw_name):
            return jsonify({"error": "Invalid folder name"}), 400
        clean_name = sanitize_path_segment(raw_name)
        if not clean_name:
            return jsonify({"error": "Folder name contains only invalid characters"}), 400
        p = safe_path(os.path.join(data.get("path", ""), clean_name), forbid_root=True)
        p.mkdir(parents=True, exist_ok=True)
        return jsonify({"success": True, "name": clean_name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/files/upload", methods=["POST"])
def upload_files():
    try:
        dest = safe_path(request.args.get("path", ""))
        rel_dest = "" if dest == STORAGE_DIR else str(dest.relative_to(STORAGE_DIR))
        files = request.files.getlist("files")
        paths = request.form.getlist("preservePaths") or request.form.getlist("paths")
        count = 0
        for i, f in enumerate(files):
            raw_rel = (paths[i].strip() if i < len(paths) else "") or ""
            candidate = raw_rel or (f.filename or "")
            if is_system_metadata_path(candidate):
                continue
            try:
                norm_rel = normalize_upload_rel_path(raw_rel, f.filename or "")
                combined = os.path.join(rel_dest, norm_rel) if rel_dest else norm_rel
                target = safe_path(combined, forbid_root=True, forbid_protected=True)
                assert_safe_file_write_target(target, dest)
            except Exception:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            f.save(target)
            count += 1
        return jsonify({"success": True, "count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/files/upload-chunk", methods=["POST", "DELETE"])
def upload_chunk():
    try:
        TMP_CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
        upload_id = request.args.get("uploadId", "").strip()

        if request.method == "DELETE":
            if upload_id and upload_id.replace("_", "").replace("-", "").isalnum():
                part_path = TMP_CHUNKS_DIR / f"{upload_id}.part"
                if part_path.exists() and part_path.is_file():
                    part_path.unlink()
            return jsonify({"success": True})

        dest = safe_path(request.args.get("path", ""))
        rel_dest = "" if dest == STORAGE_DIR else str(dest.relative_to(STORAGE_DIR))
        raw_name = (request.args.get("preservePath") or request.args.get("name") or "").strip()
        chunk_index = int(request.args.get("chunkIndex", -1))
        total_chunks = int(request.args.get("totalChunks", -1))

        if not upload_id or not upload_id.replace("_", "").replace("-", "").isalnum():
            return jsonify({"error": "Invalid upload ID"}), 400
        if chunk_index < 0 or total_chunks <= 0 or chunk_index >= total_chunks:
            return jsonify({"error": "Invalid chunk index or total"}), 400

        if is_system_metadata_path(raw_name):
            return jsonify({"success": True, "completed": True, "skipped": True})

        norm_rel = normalize_upload_rel_path(raw_name)
        combined = os.path.join(rel_dest, norm_rel) if rel_dest else norm_rel
        target = safe_path(combined, forbid_root=True, forbid_protected=True)
        assert_safe_file_write_target(target, dest)

        part_path = (TMP_CHUNKS_DIR / f"{upload_id}.part").resolve()
        if not canonicalize_path(part_path).startswith(CANONICAL_TMP_ROOT + os.sep):
            return jsonify({"error": "Security boundary violation: invalid part file location"}), 403

        mode = "wb" if chunk_index == 0 else "ab"
        with open(part_path, mode) as out:
            while True:
                chunk_bytes = request.stream.read(1024 * 1024)
                if not chunk_bytes:
                    break
                out.write(chunk_bytes)

        if chunk_index == total_chunks - 1:
            assert_safe_file_write_target(target, dest)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(str(part_path), str(target))
            if part_path.exists() and part_path.is_file():
                part_path.unlink()
            return jsonify({"success": True, "completed": True, "name": target.name})

        return jsonify({"success": True, "completed": False, "chunkIndex": chunk_index})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/files", methods=["DELETE"])
def delete_file():
    try:
        raw_path = (request.args.get("path") or "").strip()
        if not raw_path:
            return jsonify({"error": "Missing path parameter for delete"}), 400
        target = safe_path(raw_path, forbid_root=True, forbid_protected=True)
        canonical_target = canonicalize_path(target)
        if CANONICAL_MUSIC_ROOT.startswith(canonical_target + os.sep) or CANONICAL_PROJECT_ROOT.startswith(canonical_target + os.sep):
            return jsonify({"error": "FATAL SECURITY BOUNDARY: Cannot delete a parent directory of Music library or Player folder"}), 403
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target)
        else:
            target.unlink()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/files/download", methods=["GET"])
def download_file():
    try:
        raw = request.args.get("path")
        if not raw:
            return jsonify({"error": "Missing path query parameter"}), 400
        target = safe_path(raw, forbid_root=True)
        if not target.exists() or not target.is_file():
            return jsonify({"error": "File not found"}), 404
        inline = request.args.get("inline") in ("1", "true")
        return send_file(target, as_attachment=(not inline), download_name=target.name)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


if __name__ == "__main__":
    print(f"\n  Plenrip Audio File Bridge (Python NAS)\n  Local:   http://localhost:{PORT}\n  NAS:     {STORAGE_DIR}\n  Music:   {MUSIC_DIR}\n")
    app.run(host="0.0.0.0", port=PORT)
