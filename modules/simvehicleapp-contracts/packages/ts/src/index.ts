import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { SCHEMA_NAMES, schemaId, schemasDir, type SchemaName } from "./schema-names.ts";

export * from "./schema-names.ts";
export type * from "./types/index.ts";

export function loadSchema(name: SchemaName): Record<string, unknown> {
  return JSON.parse(readFileSync(`${schemasDir}${name}.v1.schema.json`, "utf8"));
}

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

/**
 * Validators for every contract schema. Schemas cross-reference each other by `$id`,
 * so all of them are registered on one Ajv instance.
 */
export class ContractValidator {
  private readonly ajv: Ajv2020;
  private readonly cache = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
    for (const name of SCHEMA_NAMES) this.ajv.addSchema(loadSchema(name));
  }

  /** `ref` is a schema name, optionally with a `#/$defs/...` fragment (e.g. `toolchain-job#/$defs/request`). */
  validate(ref: SchemaName | `${SchemaName}#${string}`, data: unknown): ValidationResult {
    const fn = this.compile(ref);
    const valid = fn(data) as boolean;
    return { valid, errors: valid ? [] : [...(fn.errors ?? [])] };
  }

  /** Throws with a readable message when `data` is invalid. */
  assert(ref: SchemaName | `${SchemaName}#${string}`, data: unknown): void {
    const { valid, errors } = this.validate(ref, data);
    if (!valid) throw new Error(`${ref}: ${this.ajv.errorsText(errors, { separator: "\n" })}`);
  }

  private compile(ref: string): ValidateFunction {
    let fn = this.cache.get(ref);
    if (!fn) {
      const [name, fragment] = ref.split("#", 2) as [SchemaName, string | undefined];
      const uri = fragment === undefined ? schemaId(name) : `${schemaId(name)}#${fragment}`;
      fn = this.ajv.getSchema(uri);
      if (!fn) throw new Error(`Unknown contract schema: ${ref}`);
      this.cache.set(ref, fn);
    }
    return fn;
  }
}
