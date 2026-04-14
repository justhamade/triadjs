# @triadjs/gherkin

Export Triad behaviors as Gherkin `.feature` files. Every `behavior()` declared on an endpoint or channel becomes a `Scenario:` block with Given/When/Then steps — ready for review, living documentation, or import into BDD tooling.

## Install

```bash
npm install @triadjs/gherkin
```

## Quick Start

```ts
import { generateGherkin, writeGherkinFiles } from '@triadjs/gherkin';
import { router } from './my-app.js';

const files = generateGherkin(router);

// Write .feature files to disk
writeGherkinFiles(files, './generated/features');

// Or inspect in memory
for (const file of files) {
  console.log(`--- ${file.filename} ---`);
  console.log(file.content);
}
```

## Features

- **Feature grouping** — scenarios are grouped by bounded context first, then by the first declared tag, with ungrouped routes collected under an `Other` feature. Context descriptions become the `Feature:` description paragraph.
- **Data tables from request bodies** — when a behavior's `given.body` is a plain object it renders as a two-column Gherkin data table (`field | value`) attached to the Given step.
- **Deterministic ordering** — bounded-context features appear in router declaration order, tag-based features are sorted alphabetically, and `Other` always comes last. Within a feature, HTTP endpoint scenarios render before channel scenarios.
- **HTTP and WebSocket support** — both endpoint behaviors and channel behaviors are emitted as scenarios in the same feature files.
- **Pure generator** — `generateGherkin()` returns an array of `FeatureFile` objects with no filesystem dependency. Use `writeGherkinFiles()` only when you need to write to disk.

## API

| Export | Description |
| --- | --- |
| `generateGherkin(router)` | Walk a router and return `FeatureFile[]` |
| `writeGherkinFiles(files, outDir, options?)` | Write feature files to disk; returns absolute paths written |
| `formatScenario(behavior, indent?)` | Render a single `Behavior` to indented Gherkin lines |
| `formatDataTable(obj, indent)` | Render a flat object as a two-column data table |
| `formatTableValue(value)` | Stringify a value for a data table cell |
| `toKebabCase(name)` | Convert a feature name to a kebab-case filename |

### WriteOptions

| Option | Default | Description |
| --- | --- | --- |
| `createDir` | `true` | Create the output directory if it does not exist |

## CLI

```bash
triad gherkin
# → writes .feature files for every behavior in the router
```

## Links

- [Triad documentation](https://github.com/justinhamade/triad)
- [Gherkin syntax reference](https://cucumber.io/docs/gherkin/reference/)
