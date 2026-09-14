import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const budgets = JSON.parse(
  fs.readFileSync(path.join(root, 'config/architecture-budget.json'), 'utf8'),
);
const scan = (folder) =>
  fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory()
      ? scan(file)
      : /\.(ts|tsx)$/.test(file)
        ? [file]
        : [];
  });
const files = [...scan('app'), ...scan('modules')];
const errors = [],
  report = [];
for (const file of files) {
  const id = file.replaceAll('\\', '/'),
    source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/).filter((line) => line.trim()).length;
  const limit = budgets.files[id] ?? budgets.defaultNonemptyLines;
  report.push({ file: id, lines, limit });
  if (lines > limit)
    errors.push(
      `${id}: ${lines} nonempty lines exceeds ${limit}; extract a cohesive responsibility.`,
    );
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (
      id.startsWith('modules/') &&
      !id.startsWith('modules/workbench/') &&
      (/^@\/app\//.test(specifier) || /(?:^|\/)workbench\//.test(specifier))
    )
      errors.push(
        `${id}: feature modules must not depend on app/workbench composition (${specifier}).`,
      );
    if (
      id.startsWith('modules/dataTransfer/') &&
      /outdoor\/exchange/.test(specifier)
    )
      errors.push(
        `${id}: dataTransfer must not depend on its legacy compatibility entry point.`,
      );
  }
}
report.sort((a, b) => b.lines - a.lines);
console.log(
  JSON.stringify(
    { checked: files.length, largest: report.slice(0, 12), errors },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;
