/**
 * @triadjs/gherkin — generate `.feature` files from a Triad router.
 *
 * ```ts
 * import { generateGherkin, writeGherkinFiles } from '@triadjs/gherkin';
 *
 * const files = generateGherkin(router);
 * writeGherkinFiles(files, './generated/features');
 * ```
 */

export {
  generateGherkin,
  toKebabCase,
  type FeatureFile,
} from './generator.js';

export {
  formatScenario,
  formatDataTable,
  formatTableValue,
} from './formatter.js';

export { writeGherkinFiles, type WriteOptions } from './writer.js';
