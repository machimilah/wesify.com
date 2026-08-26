import { defineConfig } from 'vitest/config'

/**
 * Coverage is measured and enforced rather than believed.
 *
 * The thresholds are floors under what the suite already covers, not aspirations. The point is that
 * a change which quietly stops exercising something fails the build on the day it happens, instead
 * of being noticed a year later when the untested path breaks in front of a customer.
 *
 * What is excluded is excluded for a reason, not to flatter the number:
 *   *Client.ts        thin wrappers over fetch, covered end to end by the browser suites against a
 *                     real server — a better test of them than a mocked fetch would be
 *   discoveryModel    the in-browser model loader: downloads weights and drives WebGPU, neither of
 *                     which exists in a test process
 *   local-ai.worker   a worker entry point with no logic of its own
 *   logoFile          FileReader, Image and a canvas, and no rule of its own to check
 *   naics.generated   a generated table
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', 'src/components/faces.ts'],
      exclude: ['**/*.test.ts', 'src/engine/**/*Client.ts', 'src/engine/discoveryModel.ts', 'src/engine/local-ai.worker.ts', 'src/engine/logoFile.ts'],
      // Set at what the suite actually reaches, not at a round number: a threshold above reality is
      // a broken build nobody can fix, and one below it stops catching anything. Raise them when
      // coverage rises; never lower them to make a red build green.
      thresholds: { statements: 86, branches: 76, functions: 84, lines: 92 },
    },
  },
})
