#!/usr/bin/env python3
"""Make a Velocitas C++ project buildable offline WITHOUT changing its online behaviour.

app/tests/CMakeLists.txt FetchContent-downloads googletest from GitHub at configure time.
We insert a guard: if env SV_GOOGLETEST_SRC points to an extracted copy of the *same*
archive, FetchContent uses it (FETCHCONTENT_SOURCE_DIR_GOOGLETEST). Without the env var
(VS Code devcontainer, exported project) CMake downloads exactly as before. Idempotent."""
import pathlib, sys
cm = pathlib.Path(sys.argv[1]) / "app" / "tests" / "CMakeLists.txt"
marker = "# SV: offline googletest"
text = cm.read_text()
if marker in text:
    print(f"[sv] {cm}: already patched"); sys.exit(0)
guard = (f"{marker} (no-op unless SV_GOOGLETEST_SRC is set)\n"
         "if(DEFINED ENV{SV_GOOGLETEST_SRC} AND EXISTS \"$ENV{SV_GOOGLETEST_SRC}/CMakeLists.txt\")\n"
         "  set(FETCHCONTENT_SOURCE_DIR_GOOGLETEST \"$ENV{SV_GOOGLETEST_SRC}\" CACHE PATH \"\" FORCE)\n"
         "endif()\n")
anchor = "FetchContent_MakeAvailable(googletest)"
assert anchor in text, f"{cm}: anchor not found — template changed, update overlay"
cm.write_text(text.replace(anchor, guard + anchor, 1))
print(f"[sv] {cm}: offline googletest guard inserted")
