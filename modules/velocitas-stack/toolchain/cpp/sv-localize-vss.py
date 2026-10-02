#!/usr/bin/env python3
"""Point every vehicle-signal-interface 'src' in app/AppManifest.json to a VSS file vendored
inside the project (app/vss/<file>), so download-vspec never needs network.
velocitas_lib.obtain_local_file_path() accepts paths relative to the workspace."""
import json, shutil, sys, pathlib
project, vss_file = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
cfg = json.loads((project / ".velocitas.json").read_text())
manifest_path = project / cfg.get("variables", {}).get("appManifestPath", "app/AppManifest.json")
dest = project / "app" / "vss" / vss_file.name
dest.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(vss_file, dest)
manifest = json.loads(manifest_path.read_text())
for itf in manifest.get("interfaces", []):
    if itf.get("type") == "vehicle-signal-interface":
        itf["config"]["src"] = str(dest.relative_to(project))
manifest_path.write_text(json.dumps(manifest, indent=4) + "\n")
print(f"[sv] {manifest_path} -> src={dest.relative_to(project)}")
