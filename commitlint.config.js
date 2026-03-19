export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-chinese': ({ subject }) => {
          const valid = subject != null && /^[\u4e00-\u9fa5]/.test(subject);
          return [valid, 'commit 描述必须以中文开头'];
        },
      },
    },
  ],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'chore',
        'ci',
        'revert',
      ],
    ],
    'subject-case': [0],
    'subject-chinese': [2, 'always'],
    'header-max-length': [2, 'always', 100],
  },
};
