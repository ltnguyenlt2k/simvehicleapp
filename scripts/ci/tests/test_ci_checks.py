"""Self-tests for the M00-T08 CI checks: each rule has a violating case that must be rejected
and a compliant case that must pass. Run: python3 -m unittest discover -s scripts/ci/tests"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent), str(HERE.parents[1] / "license")]

import compose_lint  # noqa: E402
import contract_only_deps  # noqa: E402
import license_scan  # noqa: E402

LICENSE_DIR = HERE.parents[1] / "license"


class TempRepo(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="sv-ci-"))
        (self.root / "modules").mkdir()

    def tearDown(self):
        shutil.rmtree(self.root)

    def write(self, rel: str, content: str) -> Path:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(textwrap.dedent(content))
        return p


@unittest.skipUnless(shutil.which("docker"), "docker compose required")
class ComposeLintTest(TempRepo):
    def env(self) -> Path:
        return self.write("ci.env", "X=1\n")

    def setup_fragment(self, service_yaml: str):
        self.write("docker-compose.yml", "name: t\ninclude:\n  - modules/a/compose.yaml\n")
        self.write("modules/a/Dockerfile", "FROM scratch\n")
        self.write("modules/a/compose.yaml", "services:\n" + textwrap.indent(textwrap.dedent(service_yaml), "  "))

    def lint(self) -> list[str]:
        return compose_lint.run(self.root, self.env())

    def test_compliant_fragment_passes(self):
        self.setup_fragment(
            """\
            app:
              build: { context: . }
              ports: ["127.0.0.1:8080:8080"]
              volumes: ["./data:/data:ro"]
            """
        )
        self.assertEqual(self.lint(), [])

    def test_docker_socket_rejected(self):
        self.setup_fragment('app:\n  image: alpine\n  volumes: ["/var/run/docker.sock:/var/run/docker.sock"]\n')
        self.assertTrue(any("Docker socket" in e for e in self.lint()))

    def test_public_port_rejected(self):
        self.setup_fragment('app:\n  image: alpine\n  ports: ["8080:8080"]\n')
        self.assertTrue(any("must bind 127.0.0.1" in e for e in self.lint()))

    def test_build_context_outside_module_rejected(self):
        self.write("modules/b/Dockerfile", "FROM scratch\n")
        self.setup_fragment("app:\n  build: { context: ../b }\n")
        self.assertTrue(any("build context" in e for e in self.lint()))

    def test_include_must_list_all_fragments(self):
        self.setup_fragment("app:\n  image: alpine\n")
        self.write("modules/c/compose.yaml", "services:\n  c:\n    image: alpine\n")
        self.assertTrue(any("include" in e for e in self.lint()))

    def test_invalid_fragment_rejected(self):
        self.setup_fragment("app:\n  image: alpine\n  environment:\n    S: ${REQUIRED:?missing}\n")
        self.assertTrue(any("invalid" in e for e in self.lint()))


class ContractOnlyDepsTest(TempRepo):
    def check(self) -> list[str]:
        return contract_only_deps.run(self.root)

    def test_contracts_dependencies_allowed(self):
        self.write("modules/simvehicleapp-contracts/package.json", '{"name":"@simvehicleapp/contracts"}')
        self.write(
            "modules/core/package.json",
            json.dumps({"dependencies": {"@simvehicleapp/contracts": "file:../simvehicleapp-contracts", "@simvehicleapp/service-kit": "1.0.0", "ajv": "8"}}),
        )
        self.write("modules/core/src/a.ts", 'import { x } from "./b.ts";\nimport y from "../src/c.ts";\n')
        self.write("modules/core/requirements.txt", "simvehicleapp-contracts==1.0.0\nrequests==2\n")
        self.assertEqual(self.check(), [])

    def test_other_module_package_rejected(self):
        self.write("modules/studio/package.json", json.dumps({"dependencies": {"@simvehicleapp/core": "1.0.0"}}))
        self.assertTrue(any("@simvehicleapp/core" in e for e in self.check()))

    def test_path_dependency_outside_module_rejected(self):
        self.write("modules/studio/package.json", json.dumps({"devDependencies": {"core": "file:../core"}}))
        self.assertTrue(any("outside the module" in e for e in self.check()))

    def test_relative_import_escaping_module_rejected(self):
        self.write("modules/studio/src/x.ts", 'export { compile } from "../../core/src/compiler";\n')
        self.assertTrue(any("escapes the module" in e for e in self.check()))

    def test_python_module_dependency_rejected(self):
        self.write("modules/ai/requirements.txt", "simvehicleapp-core==0.1\n-e ../core\n")
        errors = self.check()
        self.assertTrue(any("simvehicleapp-core" in e for e in errors))
        self.assertTrue(any("../core" in e for e in errors))

    def test_cargo_path_outside_module_rejected(self):
        self.write("modules/rust/Cargo.toml", '[dependencies]\ncore = { path = "../core" }\n')
        self.assertTrue(any("../core" in e for e in self.check()))


class LicenseScanTest(TempRepo):
    def pkg(self, rel: str, name: str, version: str, lic: str, deps: dict | None = None):
        self.write(f"{rel}/package.json", json.dumps({"name": name, "version": version, "license": lic, "dependencies": deps or {}}))

    def setup_module(self, prod_lic: str, dev_lic: str, extensions: str = "redhat.java\n"):
        m = "modules/m"
        self.write(f"{m}/package.json", json.dumps({"name": "m", "dependencies": {"lib": "1"}, "devDependencies": {"tool": "1"}}))
        self.write(f"{m}/bun.lock", "{}")
        self.pkg(f"{m}/node_modules/lib", "lib", "1.0.0", prod_lic, {"@scope/dep": "1"})
        self.pkg(f"{m}/node_modules/@scope/dep", "@scope/dep", "1.0.0", "(MIT OR Apache-2.0)")
        self.pkg(f"{m}/node_modules/tool", "tool", "1.0.0", dev_lic)
        self.write("modules/ide/cpp/extensions.txt", extensions)

    def scan(self, exceptions: str = "") -> list[str]:
        exc = self.write("exceptions.txt", exceptions)
        return license_scan.run(self.root, LICENSE_DIR / "whitelisted-licenses.txt", exc)

    def test_whitelisted_tree_passes(self):
        self.setup_module("MIT", "Apache-2.0")
        self.assertEqual(self.scan(), [])

    def test_gpl_rejected_even_for_dev(self):
        self.setup_module("MIT", "GPL-3.0-only")
        self.assertTrue(any("denylisted" in e for e in self.scan()))

    def test_non_whitelisted_prod_rejected_even_with_exception(self):
        self.setup_module("Python-2.0", "MIT")
        errors = self.scan("modules/m\tlib@1.0.0\tPython-2.0\treason\n")
        self.assertTrue(any("lib@1.0.0 (prod)" in e for e in errors))

    def test_non_whitelisted_dev_needs_exception(self):
        self.setup_module("MIT", "Python-2.0")
        self.assertTrue(any("tool@1.0.0 (dev)" in e for e in self.scan()))
        self.assertEqual(self.scan("modules/m\ttool@1.0.0\tPython-2.0\treason\n"), [])

    def test_denylisted_exception_entry_rejected(self):
        self.setup_module("MIT", "MIT")
        self.assertTrue(self.scan("modules/m\ttool@1.0.0\tAGPL-3.0\treason\n"))

    def test_missing_install_is_reported(self):
        self.write("modules/m/package.json", "{}")
        self.write("modules/m/bun.lock", "{}")
        self.assertTrue(any("not installed" in e for e in self.scan()))

    def test_forbidden_ide_extension_rejected(self):
        self.setup_module("MIT", "MIT", "llvm-vs-code-extensions.vscode-clangd\nms-vscode.cpptools@1.2.3\n")
        self.assertTrue(any("ms-vscode.cpptools" in e for e in self.scan()))


if __name__ == "__main__":
    unittest.main()
