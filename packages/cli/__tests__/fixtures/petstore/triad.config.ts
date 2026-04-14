import { defineConfig } from '@triadjs/test-runner';

export default defineConfig({
  router: './src/app.ts',
  test: {
    setup: './src/test-setup.ts',
    teardown: 'cleanup',
  },
  docs: {
    output: './generated/openapi.yaml',
  },
  gherkin: {
    output: './generated/features',
  },
});
