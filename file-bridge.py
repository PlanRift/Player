# file-bridge.py - Lightweight local storage file manager bridge for Plenrip Audio (Python Flask)
import os, shutil
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*", "allow_headers": ["Content-Type", "x-api-key", "X-API-Key"]}})

PORT = int(os.environ.get("FILE_BRIDGE_PORT", 3001))
NAS_API_KEY = os.environ.get("NAS_API_KEY") or os.environ.get("FILE_BRIDGE_KEY") or "your-secret-api-key-here"

@app.before_request
def require_api_key():
    if request.method == "OPTIONS":
        return
    api_key = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
    if not api_key or api_key != NAS_API_KEY:
        return jsonify({"error": "Unauthorized: Invalid or missing x-api-key header"}), 401
_script_dir = Path(__file__).resolve().parent
_raw_music = os.environ.get("ND_MUSICFOLDER", os.environ.get("MUSIC_DIR", ""))

if os.environ.get("STORAGE_DIR") or os.environ.get("NAS_ROOT"):
    STORAGE_DIR = Path(os.environ.get("STORAGE_DIR") or os.environ.get("NAS_ROOT")).resolve()
elif Path("G:/Server").exists():
    STORAGE_DIR = Path("G:/Server").resolve()
elif _raw_music:
    STORAGE_DIR = Path(_raw_music).resolve().parent
elif _script_dir.name.lower() == "player":
    STORAGE_DIR = _script_dir.parent
else:
    STORAGE_DIR = Path("./storage").resolve()

STORAGE_DIR.mkdir(parents=True, exist_ok=True)

def safe_path(sub=""):
    target = (STORAGE_DIR / sub).resolve()
    if not str(target).startswith(str(STORAGE_DIR)):
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
        p = safe_path(os.path.join(data.get("path", ""), data.get("name", "")))
        p.mkdir(parents=True, exist_ok=True)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/files/upload", methods=["POST"])
def upload_files():
    try:
        dest = safe_path(request.args.get("path", ""))
        files = request.files.getlist("files")
        for f in files:
            f.save(dest / f.filename)
        return jsonify({"success": True, "count": len(files)})
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

if __name__ == "__main__":
    print(f"\n  Plenrip Audio File Bridge (Python NAS)\n  Local:   http://localhost:{PORT}\n  NAS:     {STORAGE_DIR}\n")
    app.run(host="0.0.0.0", port=PORT)
