import antfu from '@antfu/eslint-config';

export default antfu(
  {
    nextjs: true,
    react: true,
    typescript: true,
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: true,
    },
    ignores: [
      'docs/**',
    ],
  },
  {
    // process and Buffer are legitimate globals in Next.js (Node.js runtime)
    rules: {
      'node/prefer-global/process': 'off',
      'node/prefer-global/buffer': 'off',
    },
  },
);
