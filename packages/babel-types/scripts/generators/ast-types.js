import * as t from "../../lib/index.js";
import stringifyValidator, {
  isValueType,
} from "../utils/stringifyValidator.js";

const parentMaps = new Map([["File", new Set(["null"])]]);

function registerParentMaps(parent, nodes) {
  for (const node of nodes) {
    if (!parentMaps.has(node)) {
      parentMaps.set(node, new Set());
    }
    parentMaps.get(node).add(parent);
  }
}

function getNodeTypesFromValidator(validator) {
  if (validator === undefined) return [];
  if (validator.each) {
    return getNodeTypesFromValidator(validator.each);
  }
  if (validator.chainOf) {
    return getNodeTypesFromValidator(validator.chainOf[1]);
  }
  let nodeTypes = [];
  if (validator.oneOfNodeTypes) {
    nodeTypes = validator.oneOfNodeTypes;
  }
  if (validator.oneOfNodeOrValueTypes) {
    nodeTypes = validator.oneOfNodeOrValueTypes.filter(
      type => !isValueType(type)
    );
  }
  return nodeTypes.flatMap(type => t.FLIPPED_ALIAS_KEYS[type] ?? type);
}

export default function generateAstTypes() {
  let code = `// NOTE: This file is autogenerated. Do not modify.
// See packages/babel-types/scripts/generators/ast-types.js for script used.

interface BaseComment {
  value: string;
  start?: number;
  end?: number;
  loc?: SourceLocation;
  // generator will skip the comment if ignore is true
  ignore?: boolean;
  type: "CommentBlock" | "CommentLine";
}

interface Position {
  line: number;
  column: number;
  index: number;
}

export interface CommentBlock extends BaseComment {
  type: "CommentBlock";
}

export interface CommentLine extends BaseComment {
  type: "CommentLine";
}

export type Comment = CommentBlock | CommentLine;

export interface SourceLocation {
  start: Position;
  end: Position;
  filename: string;
  identifierName: string | undefined | null;
}

interface BaseNode {
  type: Node["type"];
  leadingComments?: Comment[] | null;
  innerComments?: Comment[] | null;
  trailingComments?: Comment[] | null;
  start?: number | null;
  end?: number | null;
  loc?: SourceLocation | null;
  range?: [number, number];
  extra?: Record<string, unknown>;
}

export type CommentTypeShorthand = "leading" | "inner" | "trailing";

export type Node = ${t.TYPES.filter(k => !t.FLIPPED_ALIAS_KEYS[k])
    .sort()
    .join(" | ")};\n\n`;

  const deprecatedAlias = {};
  for (const type in t.DEPRECATED_KEYS) {
    deprecatedAlias[t.DEPRECATED_KEYS[type]] = type;
  }
  for (const type in t.NODE_FIELDS) {
    const fields = t.NODE_FIELDS[type];
    const fieldNames = sortFieldNames(Object.keys(t.NODE_FIELDS[type]), type);
    const struct = [];

    fieldNames.forEach(fieldName => {
      /**
       * @type {import("../../src/definitions/utils").FieldOptions}
       */
      const field = fields[fieldName];
      // Future / annoying TODO:
      // MemberExpression.property, ObjectProperty.key and ObjectMethod.key need special cases; either:
      // - convert the declaration to chain() like ClassProperty.key and ClassMethod.key,
      // - declare an alias type for valid keys, detect the case and reuse it here,
      // - declare a disjoint union with, for example, ObjectPropertyBase,
      //   ObjectPropertyLiteralKey and ObjectPropertyComputedKey, and declare ObjectProperty
      //   as "ObjectPropertyBase & (ObjectPropertyLiteralKey | ObjectPropertyComputedKey)"
      let typeAnnotation = stringifyValidator(field.validate, "");

      if (isNullable(field) && !hasDefault(field)) {
        typeAnnotation += " | null";
      }

      const alphaNumeric = /^\w+$/;
      const optional = field.optional ? "?" : "";

      if (field.deprecated) {
        struct.push("/** @deprecated */");
      }
      if (t.isValidIdentifier(fieldName) || alphaNumeric.test(fieldName)) {
        struct.push(`${fieldName}${optional}: ${typeAnnotation};`);
      } else {
        struct.push(`"${fieldName}"${optional}: ${typeAnnotation};`);
      }

      registerParentMaps(type, getNodeTypesFromValidator(field.validate));
    });

    code += `export interface ${type} extends BaseNode {
  type: "${type}";
  ${struct.join("\n  ").trim()}
}\n\n`;

    if (deprecatedAlias[type]) {
      code += `/**
 * @deprecated Use \`${type}\`
 */
export interface ${deprecatedAlias[type]} extends BaseNode {
  type: "${deprecatedAlias[type]}";
  ${struct.join("\n  ").trim()}
}\n\n
`;
    }
  }

  for (const type in t.FLIPPED_ALIAS_KEYS) {
    const types = t.FLIPPED_ALIAS_KEYS[type];
    code += `export type ${type} = ${types
      .map(type => `${type}`)
      .join(" | ")};\n`;
  }
  code += "\n";

  code += "export interface Aliases {\n";
  for (const type in t.FLIPPED_ALIAS_KEYS) {
    code += `  ${type}: ${type};\n`;
  }
  code += "}\n\n";
  code += `export type DeprecatedAliases = ${Object.keys(
    t.DEPRECATED_KEYS
  ).join(" | ")}\n\n`;

  code += "export interface ParentMaps {\n";

  registerParentMaps("null", [...Object.keys(t.DEPRECATED_KEYS)]);
  // todo: provide a better parent type for Placeholder, currently it acts
  // as a catch-all parent type for an abstract NodePath, s.t NodePath.parent must
  // be a Node if type has not been specified
  registerParentMaps("Node", ["Placeholder"]);

  const parentMapsKeys = [...parentMaps.keys()].sort();
  for (const type of parentMapsKeys) {
    const deduplicated = [...parentMaps.get(type)].sort();
    code += `  ${type}: ${deduplicated.join(" | ")};\n`;
  }
  code += "}\n\n";

  return code;
}

function hasDefault(field) {
  return field.default != null;
}

function isNullable(field) {
  return field.optional || hasDefault(field);
}

function sortFieldNames(fields, type) {
  return fields.sort((fieldA, fieldB) => {
    const indexA = t.BUILDER_KEYS[type].indexOf(fieldA);
    const indexB = t.BUILDER_KEYS[type].indexOf(fieldB);
    if (indexA === indexB) return fieldA < fieldB ? -1 : 1;
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}
