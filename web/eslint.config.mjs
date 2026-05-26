import nextVitals from "@next/eslint-plugin-next";

const nextCoreWebVitals = nextVitals.configs["core-web-vitals"];

export default [
  {
    ignores: [".next/**", "node_modules/**", "coverage/**"]
  },
  nextCoreWebVitals
];
