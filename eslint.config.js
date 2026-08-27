import globals from 'globals';

export default [
  {ignores:['.work/**','node_modules/**','**/data/**','**/backups/**']},
  {
    files:['netunim-*/site/**/*.js','shared/**/*.js'],
    languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.serviceworker}},
    linterOptions:{noInlineConfig:true},
    rules:{
      'no-undef':'error', 'no-dupe-args':'error', 'no-dupe-keys':'error',
      'no-unreachable':'error', 'no-fallthrough':'error', 'no-global-assign':'error',
      'no-import-assign':'error', 'no-async-promise-executor':'error',
      'no-eval':'error', 'no-new-func':'error', 'no-implied-eval':'error',
      'no-constant-binary-expression':'error'
      ,'no-unused-vars':['error',{args:'none',caughtErrors:'none',ignoreRestSiblings:true}]
    }
  }
];
