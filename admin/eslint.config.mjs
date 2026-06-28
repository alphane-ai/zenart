import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "test-results/**", "playwright-report/**"]
  },
  {
    rules: {
      "react/no-unescaped-entities": "off"
    }
  }
];

export default config;
