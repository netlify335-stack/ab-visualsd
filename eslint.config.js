import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', '.playwright-cli/**/*', 'ab-visuals-vercel.zip'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
