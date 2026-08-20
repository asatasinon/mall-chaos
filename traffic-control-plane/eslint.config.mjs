import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
	...nextVitals,
	...nextTypescript,
	{
		rules: {
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': 'warn',
			'@typescript-eslint/no-require-imports': 'warn',
			'react-hooks/set-state-in-effect': 'warn',
		},
	},
];

export default config;