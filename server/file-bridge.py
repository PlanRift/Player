# file-bridge.py - Lightweight local storage file manager bridge for Plenrip Audio (Python Flask)
import os, shutil
from pathlib import Path
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": ["https://plenrip.planrift.me", "http://localhost:5500", "http://127.0.0.1:5500", "http://localhost:3001", "http://127.0.0.1:3001", "*"], "allow_headers": ["Content-Type", "x-api-key", "X-API-Key"]}})

_script_dir = Path(__file__).resolve().parent

# Load .env if present (project root or script dir)
_env_candidates = [
    _script_dir.parent / ".env",
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
    raise SystemExit("ERROR: A real NAS API key is required. Set NAS_API_KEY to a long random value (not the placeholder). The bridge refuses to start without one.")

@app.before_request
def require_api_key():
    if request.method == "OPTIONS":
        return
    # Century bridge: x-api-key header on every request. Native browser
    # downloads cannot set headers, so /api/files/download also accepts
    # ?apiKey. Every other endpoint requires the header.
    is_download = request.path == "/api/files/download"
    api_key = (
        request.headers.get("x-api-key")
        or request.headers.get("X-API-Key")
        or (request.args.get("apiKey") or request.args.get("key") or request.args.get("x-api-key") if is_download else None)
    )
    if not api_key or api_key != NAS_API_KEY:
        return jsonify({"error": "Unauthorized: Invalid or missing API key (provide x-api-key header" + (" or ?apiKey= parameter" if is_download else "") + ")"}), 401
_script_dir = Path(__file__).resolve().parent

# Storage root: only STORAGE_DIR / NAS_ROOT, else ./storage at the
# project root (Century bridge rule). No auto-detection of G:/Server or the
# music folder's parent.
if os.environ.get("STORAGE_DIR") or os.environ.get("NAS_ROOT"):
    STORAGE_DIR = Path(os.environ.get("STORAGE_DIR") or os.environ.get("NAS_ROOT")).resolve()
else:
    STORAGE_DIR = (_script_dir.parent / "storage").resolve()

STORAGE_DIR.mkdir(parents=True, exist_ok=True)

def safe_path(sub=""):
    # Century resolveSafePath: the root + separator check also rejects a
    # sibling directory whose name merely starts with the root.
    root = STORAGE_DIR
    target = (root / sub).resolve()
    if target != root and not str(target).startswith(str(root) + os.sep):
        raise PermissionError("Access denied: path traversal")
    return target

@app.route("/api/files", methods=["GET"])
def list_files():
    try:
        p = safe_path(request.args.get("path", ""))
        items = []
        for entry in os.scandir(p):
            try:
                stat = entry.stat()
                items.append({
                    "name": entry.name,
                    "isDirectory": entry.is_dir(),
                    "size": stat.st_size,
                    "mtime": stat.st_mtime * 1000
                })
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
        # Century parity: a folder name must be a single segment — reject
        # '/', '\', '.', '..' with a 400 instead of silently creating
        # nested folders (or surfacing a 500 for '..').
        name = str(data.get("name", ""))
        if not name or name in (".", "..") or "/" in name or "\\" in name:
            return jsonify({"error": "Invalid folder name"}), 400
        p = safe_path(os.path.join(data.get("path", ""), name))
        p.mkdir(parents=True, exist_ok=True)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/files/upload", methods=["POST"])
def upload_files():
    # Century bridge: folder upload via a parallel `paths` form field (one
    # webkitRelativePath per file, same order as `files`). Parent dirs are
    # created (mkdir -p). Without a path, the file lands by basename.
    # A path that escapes the destination is skipped, not an error.
    try:
        dest = safe_path(request.args.get("path", ""))
        dest.mkdir(parents=True, exist_ok=True)
        files = request.files.getlist("files")
        paths = request.form.getlist("paths")
        count = 0
        for i, f in enumerate(files):
            rel = (paths[i].strip() if i < len(paths) else "") or ""
            if rel:
                if rel.startswith("/") or rel.startswith("\\") or ".." in rel.split("/"):
                    continue
                try:
                    target = safe_path(os.path.join(str(dest.relative_to(STORAGE_DIR)) if dest != STORAGE_DIR else "", rel))
                    if target == dest or not str(target).startswith(str(dest) + os.sep):
                        continue
                except Exception:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                f.save(target)
                count += 1
            else:
                name = os.path.basename(f.filename or "")
                if not name or name in (".", ".."):
                    continue
                f.save(dest / name)
                count += 1
        return jsonify({"success": True, "count": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/files", methods=["DELETE"])
def delete_file():
    try:
        target = safe_path(request.args.get("path", ""))
        if target == STORAGE_DIR or target == _script_dir:
            return jsonify({"error": "Cannot delete server root or Player application folder"}), 400
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/files/download", methods=["GET"])
def download_file():
    try:
        raw = request.args.get("path")
        if not raw:
            return jsonify({"error": "Missing path query parameter"}), 400
        target = safe_path(raw)
        if not target.exists() or not target.is_file():
            return jsonify({"error": "File not found"}), 404
        inline = request.args.get("inline") in ("1", "true")
        return send_file(target, as_attachment=(not inline), download_name=target.name)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print(f"\n  Plenrip Audio File Bridge (Python NAS)\n  Local:   http://localhost:{PORT}\n  NAS:     {STORAGE_DIR}\n")
    app.run(host="0.0.0.0", port=PORT)
