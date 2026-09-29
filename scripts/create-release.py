from pathlib import Path
import tarfile

root = Path(__file__).resolve().parents[1]
archive = root / "restaurant-report.tar.gz"
excluded_dirs = {"node_modules", "dist", "pos-pages", ".git", "__pycache__"}
excluded_names = {archive.name, ".env", "wuuxiang-index.html", "wuuxiang-app.js", "wuuxiang-core.js", "wuuxiang-item.json", "wuuxiang-page-442.json"}

with tarfile.open(archive, "w:gz") as tar:
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if any(part in excluded_dirs for part in relative.parts) or path.name in excluded_names:
            continue
        if path.is_file():
            tar.add(path, arcname=relative.as_posix())

print(archive)
