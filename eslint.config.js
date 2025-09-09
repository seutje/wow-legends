import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off"
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-empty": "off"
    }
  }
];
