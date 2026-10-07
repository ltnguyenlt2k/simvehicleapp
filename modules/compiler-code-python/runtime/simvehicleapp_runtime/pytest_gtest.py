"""pytest plugin: reports generated tests as gtest console lines (``-p simvehicleapp_runtime.pytest_gtest``).

The orchestrator reads the test job's log the way it reads the C++ generated tests (``[ RUN      ]``,
``[  FAILED  ]``, the ``[==========] N tests from M test suites ran.`` summary): a test in
``test_<module>.py`` is ``<module>Test.<name>``, ``<module>`` being the workflow's generated module, so a
failure maps to its workflow (ADR-0040 §4).
"""

from __future__ import annotations

import os
from typing import Any, List, Set


def _name(nodeid: str) -> str:
    file, _, test = nodeid.partition("::")
    module = os.path.basename(file)[:-3]
    if module.startswith("test_"):
        module = module[len("test_") :]
    return f"{module}Test.{test}"


class _Report:
    def __init__(self, config: Any) -> None:
        self.config = config
        self.count = 0
        self.suites: Set[str] = set()
        self.failed: List[str] = []

    def _line(self, text: str) -> None:
        tr = self.config.pluginmanager.get_plugin("terminalreporter")
        if tr is not None:
            # Progress dots must not prefix the line: the orchestrator anchors on "[".
            if getattr(tr._tw, "width_of_current_line", 0):
                tr._tw.line()
            tr.write_line(text)

    def pytest_runtest_logstart(self, nodeid: str, location: Any) -> None:
        self._line(f"[ RUN      ] {_name(nodeid)}")

    def pytest_runtest_logreport(self, report: Any) -> None:
        if report.when != "call" and not (report.when == "setup" and report.outcome != "passed"):
            return
        name = _name(report.nodeid)
        self.count += 1
        self.suites.add(name.split(".")[0])
        ms = int(report.duration * 1000)
        if report.outcome == "failed":
            # The crash message first: the orchestrator shows the first line of a failure.
            crash = getattr(getattr(report.longrepr, "reprcrash", None), "message", "")
            for line in [*str(crash).splitlines(), *str(report.longreprtext).splitlines()]:
                self._line(line)
            self._line(f"[  FAILED  ] {name} ({ms} ms)")
            self.failed.append(name)
        elif report.outcome == "passed":
            self._line(f"[       OK ] {name} ({ms} ms)")

    def pytest_terminal_summary(self, terminalreporter: Any) -> None:
        s = "s" if len(self.suites) != 1 else ""
        t = "s" if self.count != 1 else ""
        self._line(f"[==========] {self.count} test{t} from {len(self.suites)} test suite{s} ran.")
        self._line(f"[  PASSED  ] {self.count - len(self.failed)} test{'s' if self.count - len(self.failed) != 1 else ''}.")
        if self.failed:
            self._line(f"[  FAILED  ] {len(self.failed)} test{'s' if len(self.failed) != 1 else ''}, listed below:")
            for name in self.failed:
                self._line(f"[  FAILED  ] {name}")


def pytest_configure(config: Any) -> None:
    config.pluginmanager.register(_Report(config), "simvehicleapp-gtest-report")
