"""Package the current editable composition, assets and verified evidence."""

import hashlib
import json
from pathlib import Path
import zipfile

project = Path(__file__).resolve().parent
output = project / "renders" / "lockpad-demo-editable.zip"
timing = json.loads((project / "timing.json").read_text())
capture = json.loads((project / "capture-borrow.json").read_text())
delivery = json.loads((project / "evidence/delivery.json").read_text())
if timing["duration"] != 120 or capture["status"] != "PASS" or delivery["status"] != "PASS":
    raise RuntimeError("The current two-minute borrow-or-sell export must pass before packaging")

root_files = [
    "AGENTS.md", "README.md", "SPEC.md", "STORYBOARD.md", "REVIEW.md",
    "index.html", "hyperframes.json", "package.json", "meta.json",
    "narration-borrow.json", "narration.txt", "timing.json", "voice-borrow.json",
    "capture-borrow.json", "build.mjs", "verify.mjs", "review-sheets.mjs",
    "prepare-borrow.mjs", "capture-borrow.mjs", "package.py",
]
files = [project / name for name in root_files]
for directory in ("assets/fonts", "assets/vendor", "assets/voice-borrow"):
    files += sorted(path for path in (project / directory).rglob("*") if path.is_file())
for scene in timing["scenes"]:
    files.append(project / scene["video"])
for clip in capture["clips"]:
    files.append(project / clip["src"])
    files.append(project / clip["still"])
files += sorted((project / "compositions").glob("*.html"))
files += [project / "evidence" / name for name in (
    "check.json", "review-beats.jpg", "review-phone.jpg", "review-seams.jpg",
    "delivery.json", "audio.json", "decoded-frames.jpg",
    "repay-title-47.3s.png", "repay-title-52.5s.png",
)]
files = sorted(set(files))
for path in files:
    if not path.is_file():
        raise RuntimeError(f"Required source file is missing: {path.relative_to(project)}")

manifest = {
    "project": "Lockpad borrow-or-sell narrated prototype",
    "durationSeconds": timing["duration"],
    "width": timing["width"],
    "height": timing["height"],
    "fps": timing["fps"],
    "files": {
        str(path.relative_to(project)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in files
    },
}
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
    for path in files:
        bundle.write(path, "lockpad-demo/" + str(path.relative_to(project)))
    bundle.writestr("lockpad-demo/MANIFEST.json", json.dumps(manifest, indent=2) + chr(10))

with zipfile.ZipFile(output) as bundle:
    if bundle.testzip() is not None:
        raise RuntimeError("The editable bundle failed its CRC verification")
    for relative, expected in manifest["files"].items():
        actual = hashlib.sha256(bundle.read("lockpad-demo/" + relative)).hexdigest()
        if actual != expected:
            raise RuntimeError(f"Bundle checksum mismatch: {relative}")

print(f"EDITABLE PACKAGE PASS: {len(files)} source files, {output.stat().st_size / 1048576:.1f} MiB")
print(output)
