import { type TLocalizedValidationError } from "typebox/error";
import { Settings } from "typebox/system";
import { type Validator } from "typebox/compile";

/**
 * What `validator` found wrong with `value`, each led by where: `label` and the path inside it,
 * such as `sandbox.network`.
 */
export function schemaErrors(validator: Validator, value: unknown, label: string): string[] {
  if (validator.Check(value)) return [];
  return allErrors(validator, value).flatMap((e) =>
    messages(e).map(([path, message]) => {
      const where = [label, ...path.split("/")].filter(Boolean).join(".");
      return where ? `${where} ${message}` : message;
    })
  );
}

/**
 * Every error, not TypeBox's first eight: a wrong hook lists what each kind of hook needs. Each
 * value checked is one setting, server or request body, so the list stays short. The limit is
 * TypeBox's process-wide setting, so it is put back for anything else in the process using it.
 */
function allErrors(validator: Validator, value: unknown): TLocalizedValidationError[] {
  const { maxErrors } = Settings.Get();
  Settings.Set({ maxErrors: Number.POSITIVE_INFINITY });
  try {
    return validator.Errors(value);
  } finally {
    Settings.Set({ maxErrors });
  }
}

/**
 * An error as where it is and what is wrong, worded as ccdesk has always shown them: one missing
 * property at a time, and one "must NOT have additional properties" for each property a closed
 * object does not allow.
 */
function messages(e: TLocalizedValidationError): [string, string][] {
  switch (e.keyword) {
    case "required":
      return e.params.requiredProperties.map((p) => [
        e.instancePath,
        `must have required property '${p}'`,
      ]);
    // Said once for each extra property, through its "schema is false" error below; a property
    // that fails an additionalProperties schema has its own error already.
    case "additionalProperties":
      return [];
    case "boolean":
      if (!e.schemaPath.endsWith("/additionalProperties")) return [[e.instancePath, e.message]];
      return [
        [
          e.instancePath.slice(0, e.instancePath.lastIndexOf("/")),
          "must NOT have additional properties",
        ],
      ];
    case "enum":
      return [[e.instancePath, `${e.message}: ${e.params.allowedValues.join(", ")}`]];
    case "minItems":
      return [[e.instancePath, `must NOT have fewer than ${e.params.limit} items`]];
    default:
      return [[e.instancePath, e.message]];
  }
}
