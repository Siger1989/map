const MAX_TEMPLATE_LENGTH = 8192;
const MAX_EXPRESSION_LENGTH = 16;
const MAX_LITERAL = 1_000_000;
const MAX_RESULT = 1_000_000_000;
const MAX_ZOOM = 30;
const BING_QUADKEY_SEQUENCE = '{$x}{$y}{$z}{4}';

type TileCoordinate = 'x' | 'y' | 'z';
type TemplateToken =
  | { kind: 'coordinate'; variable: TileCoordinate; operator?: string; operand?: number }
  | { kind: 'galileo' };

function parseToken(content: string): TemplateToken | undefined {
  if (content === 'Galileo') return { kind: 'galileo' };
  if (content.length > MAX_EXPRESSION_LENGTH) return;

  const match = /^(x|y|z)(?:([+\-*/])(\d{1,6}))?$/.exec(content);
  if (!match) return;
  const [, variable, operator, operandText] = match;
  const operand = operandText === undefined ? undefined : Number(operandText);
  if (operand !== undefined && operand > MAX_LITERAL) return;
  if (operator === '/' && operand === 0) return;
  return {
    kind: 'coordinate',
    variable: variable as TileCoordinate,
    operator,
    operand,
  };
}

function scanTemplate(template: string): TemplateToken[] | undefined {
  if (typeof template !== 'string' || template.length === 0 || template.length > MAX_TEMPLATE_LENGTH)
    return;

  const tokens: TemplateToken[] = [];
  const placeholder = /\{(\$?)([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = placeholder.exec(template))) {
    const isOvmapVariable = match[1] === '$';
    const content = match[2];
    if (isOvmapVariable) {
      const token = parseToken(content);
      if (!token) return;
      tokens.push(token);
      continue;
    }
    // Also accept the {x}/{y}/{z} form already used by this app. Other ordinary
    // brace text (for example {4}) is literal and is preserved unchanged.
    if (/^[xyz](?:[+\-*/]\d{1,6})?$/.test(content)) {
      const token = parseToken(content);
      if (!token || token.kind !== 'coordinate') return;
      tokens.push(token);
    }
  }

  // Reject malformed placeholders too; recognized complete OVMAP placeholders
  // are removed first so their {$ prefix is not mistaken for an open token.
  const afterVariables = template.replace(/\{\$[^{}]*\}/g, '');
  if (/\{\$|\$\}/.test(afterVariables)) return;
  return tokens;
}

/**
 * Return whether an OVMAP URL template uses only the bounded syntax understood here.
 * `{$Galileo}` uses the observed legacy Google tile salt pattern.
 */
export function supportedOvmapTemplate(template: string): boolean {
  const tokens = scanTemplate(template);
  if (!tokens) return false;
  return tokens.length > 0;
}

function evaluate(token: Extract<TemplateToken, { kind: 'coordinate' }>, values: Record<TileCoordinate, number>): number {
  const base = values[token.variable];
  if (token.operator === undefined || token.operand === undefined) return base;

  let result: number;
  switch (token.operator) {
    case '+': result = base + token.operand; break;
    case '-': result = base - token.operand; break;
    case '*': result = base * token.operand; break;
    case '/': result = Math.floor(base / token.operand); break;
    default: throw new Error('OVMAP 模板运算符无效');
  }
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_RESULT)
    throw new Error('OVMAP 模板运算结果超出安全范围');
  return result;
}

/** Render XYZ arithmetic without evaluating JavaScript; deferred tokens are preserved. */
export function renderOvmapTemplate(template: string, z: number, x: number, y: number): string {
  const tokens = scanTemplate(template);
  if (!tokens || !supportedOvmapTemplate(template))
    throw new Error('OVMAP 瓦片模板包含不支持的语法');
  if (!Number.isInteger(z) || z < 0 || z > MAX_ZOOM)
    throw new Error(`OVMAP 缩放级别须为 0–${MAX_ZOOM} 的整数`);
  const maxCoordinate = 2 ** z - 1;
  if (![x, y].every((value) => Number.isInteger(value) && value >= 0 && value <= maxCoordinate))
    throw new Error('OVMAP 瓦片坐标超出当前缩放级别');

  const values: Record<TileCoordinate, number> = { x, y, z };
  // OVMAP Bing templates encode one tile as the adjacent XYZ tokens followed
  // by `{4}`. In that exact compound form, 4 marks the quadkey encoding; a
  // standalone `{4}` elsewhere remains ordinary literal URL text.
  const withQuadkeys = template.replaceAll(BING_QUADKEY_SEQUENCE, quadkey(z, x, y));
  return withQuadkeys.replace(/\{(\$?)([^{}]*)\}/g, (whole, prefix: string, content: string) => {
    const isOvmapVariable = prefix === '$';
    const isCoordinate = /^[xyz](?:[+\-*/]\d{1,6})?$/.test(content);
    if (!isOvmapVariable && !isCoordinate) return whole;
    const token = parseToken(content);
    if (!token) {
      if (!isOvmapVariable) return whole;
      throw new Error('OVMAP 瓦片模板包含不支持的语法');
    }
    if (token.kind === 'galileo') return 'Galileo'.slice(0, (3 * x + y) % 8);
    return String(evaluate(token, values));
  });
}

function quadkey(z: number, x: number, y: number): string {
  let result = '';
  for (let level = z; level > 0; level -= 1) {
    const bit = 2 ** (level - 1);
    const xBit = Math.floor(x / bit) % 2;
    const yBit = Math.floor(y / bit) % 2;
    result += String(xBit + yBit * 2);
  }
  return result;
}
