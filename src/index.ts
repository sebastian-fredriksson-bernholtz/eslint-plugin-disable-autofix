import fs from 'node:fs';
import path from 'node:path';

import appRoot from 'app-root-path';
import { Rule, Linter, AST, SourceCode } from 'eslint';
import ruleComposer from 'eslint-rule-composer';
import _ from 'lodash';

interface EslintPlugin {
  rules: { [key: string]: Rule.RuleModule };
  id: string;
}

interface Problem {
  message: string;
  messageId: string | undefined;
  data: object | undefined;
  loc: AST.SourceLocation;
  fix: undefined;
}

interface Metadata {
  sourceCode: SourceCode;
  settings?: object;
  filename: string;
}

interface DisabledRules {
  [name: string]: Rule.RuleModule;
}

type Predicate<T> = (problem: Problem, metadata: Metadata) => T;

type MapReports = (
  rule: Rule.RuleModule,
  iteratee: Predicate<Problem>,
) => Rule.RuleModule;

const linter = new Linter();
const disabledRules: DisabledRules = {};
const dirname = appRoot.toString();
const nodeModules = 'node_modules/';
const importedPlugins = [];

const map = (ruleComposer as { mapReports: MapReports }).mapReports;

// delete metadata fixable property
const disableMeta = (rule: Rule.RuleModule) => {
  if (rule.meta?.fixable) {
    delete rule.meta.fixable;
  }
  return rule;
};

// delete map reports fix method
const disableFix = (rule: Rule.RuleModule) => {
  const disableReports = map(rule, (problem) => {
    delete problem.fix;
    return problem;
  });
  return disableMeta(disableReports);
};

// handle name conversion
const convertPluginId = (pluginId: string) => {
  return pluginId.includes('@')
    ? // `@angular-eslint/eslint-plugin` -> `@angular-eslint`
      // `@angular-eslint/eslint-plugin-template` -> `@angular-eslint/template`
      pluginId.replace(/eslint-plugin(-|)/u, '').replace(/\/$/, '')
    : // `eslint-plugin-react` -> `react`
      pluginId.replace(/^eslint-plugin-/u, '');
};

// disable builtin rules√
const builtinRules = linter.getRules();
for (const [ruleId, rule] of builtinRules) {
  disabledRules[ruleId] = disableFix(_.cloneDeep(rule));
}

// read eslint plugins
const eslintPlugins = fs
  .readdirSync(path.join(dirname, nodeModules))
  .filter(
    (plugin) =>
      (plugin.startsWith('eslint-plugin') ||
        (plugin.startsWith('@') && /eslint/u.test(plugin))) &&
      plugin !== 'eslint-plugin-disable-autofix' &&
      plugin !== '@eslint',
  );

// import eslint plugins
for (const plugin of eslintPlugins) {
  if (plugin.includes('@')) {
    const pluginDirectories = fs
      .readdirSync(path.join(dirname, nodeModules, plugin))
      .filter((read) => /plugin/u.test(read));
    for (const pluginDirectory of pluginDirectories) {
      const scopedPlugin = path.join(plugin, pluginDirectory);
      const importedPlugin = require(scopedPlugin) as EslintPlugin;
      importedPlugin.id = scopedPlugin.replace(
        path.join(dirname, nodeModules),
        '',
      );
      importedPlugins.push(importedPlugin);
    }
  } else {
    const imported = require(plugin) as EslintPlugin;
    imported.id = plugin;
    importedPlugins.push(imported);
  }
}

// disable plugin rules
for (const plugin of importedPlugins) {
  const pluginRules = plugin.rules || {};
  const pluginId = plugin.id || '';
  const pluginName = convertPluginId(pluginId);
  for (const ruleId of Object.keys(pluginRules)) {
    disabledRules[`${pluginName}/${ruleId}`] = disableFix(
      _.cloneDeep(pluginRules[ruleId]),
    );
  }
}

const plugin = {
  rules: disabledRules,
};

export default plugin;
