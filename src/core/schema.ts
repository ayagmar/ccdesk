import { Ajv, type ValidateFunction } from "ajv";

export const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * What `validate` found wrong with `value`, each led by where: `label` and the path inside it, such
 * as `sandbox.network`.
 */
export function schemaErrors(validate: ValidateFunction, value: unknown, label: string): string[] {
  if (validate(value)) return [];
  return (validate.errors ?? []).map((e) => {
    const where = [label, ...e.instancePath.split("/")].filter(Boolean).join(".");
    const allowed =
      e.keyword === "enum" ? `: ${(e.params.allowedValues as unknown[]).join(", ")}` : "";
    return `${where} ${e.message ?? "is invalid"}${allowed}`;
  });
}
