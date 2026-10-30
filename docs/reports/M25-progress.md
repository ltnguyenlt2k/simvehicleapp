# M25 progress

M23 prerequisite PASS. ADR-0069 and M25 explicitly allow the compiler/mock branch
independently of the M24 live soak. No M24 acceptance is inferred from this work.
M24 local gates now PASS, its final fresh-zero fixture CI still pending.

T01 local PASS: closed Draft 2020-12 robotflow.v1, block.v1 and recursive typed
rfir.v1; graph identities/vars/ports, declarative registry metadata and migrations,
all command result branches, explicit source IDs, profile/catalog/runtime hashes.
Nine contract test groups PASS /0.142 s in pinned Python 3.12, network-none,
read-only nonroot container. Includes malformed identities/types, executable/
unknown payload fields/opcodes, incomplete outcomes, numeric type confusion/
uint8 overflow and deterministic generator/schema equality. Initial red test
failed because schemas were absent, retained in ignored runtime/m24; later logs
under runtime/m25. Localized RF1001–RF6006 catalog added without deleting RSS/PB
entries; actual compiler negative coverage for every RF code remains T04.

ADR-0076 records exact wire decisions and limits of schema validation. New tool
image owns its context; only contract artifacts shared, no ROS or vehicle import.
Dependencies reuse existing pinned robotics versions. CI contract/OSV steps added;
CI requalification pending. Registry T02, expression parser T03, compiler/emitter,
runtime, conformance and live RW-A..D remain OPEN. No workflow/UI/video delivered.

Final Compose tool-image test covers every statement/trigger wire family; RSS
contract regression 20 PASS /0.511 s, dependency/pin guard and full-profile Compose
config PASS. JSON schemas do not implement semantic reachability/units/safety;
those deliberate negative cases remain required before compiler acceptance.
