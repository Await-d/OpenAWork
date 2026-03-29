const SISYPHUS_FOOTER =
  'Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)';
const SISYPHUS_TRAILER = 'Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>';

function getCommitSupplement(body, footer) {
  return [body, footer].filter(Boolean).join('\n\n');
}

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-chinese': ({ subject }) => {
          const valid = subject != null && /^[\u4e00-\u9fa5]/.test(subject);
          return [valid, 'commit 描述必须以中文开头'];
        },
        'sisyphus-attribution': ({ body, footer }) => {
          const supplement = getCommitSupplement(body, footer);
          const mentionsSisyphusFooter = supplement.includes('Ultraworked with');
          const mentionsSisyphusTrailer = supplement.includes('Co-authored-by: Sisyphus');
          const hasApprovedFooter = supplement.includes(SISYPHUS_FOOTER);
          const hasApprovedTrailer = supplement.includes(SISYPHUS_TRAILER);
          const valid =
            (!mentionsSisyphusFooter || hasApprovedFooter) &&
            (!mentionsSisyphusTrailer || hasApprovedTrailer) &&
            hasApprovedFooter === hasApprovedTrailer;

          return [valid, '使用 Sisyphus 协作尾注时，必须成对使用仓库约定的标准 footer 与 trailer'];
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
    'scope-empty': [2, 'never'],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-case': [0],
    'subject-chinese': [2, 'always'],
    'sisyphus-attribution': [2, 'always'],
    'header-max-length': [2, 'always', 100],
  },
};
