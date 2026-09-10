import type { Config } from 'tailwindcss';
import { tailwindConfig } from '@sentinel/config/tailwind';

const config: Config = {
  ...tailwindConfig,
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};

export default config;
