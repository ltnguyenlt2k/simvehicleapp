/**
 * GW-A with three test cases (ADR-0058 §2, M18-T03): the golden scenario, a scenario 1.1 case with `never`, and a
 * repeated name (unique test names). Shared by the generator test (golden-cases/) and the staged project.
 */
export function gwaCases(workflowId: string, golden: Record<string, unknown>) {
  const below = {
    scenarioVersion: "1.1.0",
    name: "Below the limit",
    until: 4000,
    inputs: [{ t: 0, path: "Vehicle.Speed", value: 100 }],
    expect: { never: [{ path: "Vehicle.Body.Lights.Hazard.IsSignaling" }] },
  };
  return [
    { workflowId, scenario: golden, caseName: "Overspeed held 2 s" },
    { workflowId, scenario: below, caseName: "Below the limit" },
    { workflowId, scenario: golden, caseName: "Overspeed held 2 s" },
  ];
}
