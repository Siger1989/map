import selectorParser from 'postcss-selector-parser';
import { createHash } from 'node:crypto';

const maximum = (values) =>
  values.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0] || [
    0, 0, 0,
  ];
function specificity(node) {
  if (node.type === 'id') return [1, 0, 0];
  if (node.type === 'class' || node.type === 'attribute') return [0, 1, 0];
  if (node.type === 'tag') return [0, 0, 1];
  if (node.type === 'pseudo') {
    if (node.value === ':where') return [0, 0, 0];
    if ([':is', ':not', ':has'].includes(node.value))
      return maximum(node.nodes.map(specificity));
    return node.value.startsWith('::') ? [0, 0, 1] : [0, 1, 0];
  }
  return (node.nodes || [])
    .map(specificity)
    .reduce(
      (sum, weight) => sum.map((value, index) => value + weight[index]),
      [0, 0, 0],
    );
}

/** APK-only relational styles, without patching native DOM selector APIs. */
export default function mobileHasCompatibility() {
  return {
    postcssPlugin: 'shantu-mobile-has',
    OnceExit(root, { AtRule, Rule, Declaration }) {
      const recipes = new Map();
      const rules = [];
      root.walkRules((rule) => {
        if (rule.selector.includes(':has(')) rules.push(rule);
      });
      for (const rule of rules) {
        const ast = selectorParser().astSync(rule.selector);
        ast.each((selector) => {
          const has = selector.nodes.filter(
            (node) => node.type === 'pseudo' && node.value === ':has',
          );
          for (const pseudo of has) {
            let unsupported = false;
            pseudo.walkPseudos((node) => {
              if (node.value === ':has') unsupported = true;
            });
            if (unsupported)
              throw rule.error(`Nested relational predicate: ${rule.selector}`);
            const candidate =
              selector.nodes
                .slice(0, selector.index(pseudo))
                .map((node) => node.toString())
                .join('')
                .trim() || '*';
            const inner = pseudo.nodes
              .map((node) => {
                const value = node.toString().trim();
                if (/^[+~]/.test(value))
                  throw rule.error(
                    `Sibling relational predicate: ${rule.selector}`,
                  );
                return value.startsWith('>') ? `:scope ${value}` : value;
              })
              .join(',');
            const encoded = Buffer.from(
              JSON.stringify({ candidate, inner }),
            ).toString('hex');
            const key = createHash('sha256')
              .update(encoded)
              .digest('hex')
              .slice(0, 12);
            recipes.set(key, encoded);
            const weights = specificity(pseudo);
            const className = `.shantu-has-${key}`;
            const replacement = weights[1]
              ? className.repeat(weights[1])
              : `:where(${className})`;
            const suffix =
              ':not(#shantu-compat-never)'.repeat(weights[0]) +
              ':not(shantu-compat-never)'.repeat(weights[2]);
            pseudo.replaceWith(
              ...selectorParser().astSync(replacement + suffix).first.nodes,
            );
          }
        });
        const fallback = new AtRule({
          name: 'supports',
          params: 'not selector(:has(*))',
        });
        fallback.append(rule.clone({ selector: ast.toString() }));
        rule.after(fallback);
      }
      if (recipes.size) {
        const metadata = new Rule({ selector: ':root' });
        for (const [key, value] of recipes)
          metadata.append(
            new Declaration({ prop: `--shantu-has-${key}`, value }),
          );
        root.append(metadata);
      }
    },
  };
}
