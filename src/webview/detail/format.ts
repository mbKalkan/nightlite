import { escapeHtml } from '../grid/cells';

/** Past this, JSON is re-indented but not colored: hundreds of thousands of spans are slow. */
const COLOR_LIMIT = 256 * 1024;

const JSON_TOKEN =
  /\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,])/y;

/**
 * A JSON object or array, re-indented as HTML with keys, strings, numbers and literals in
 * spans; undefined for anything else. Numbers keep the digits they were written with, where
 * `JSON.parse` would round integers beyond 2^53.
 */
export function formatJson(text: string): string | undefined {
  const source = text.trim();
  if (!/^[[{]/.test(source)) return undefined;
  try {
    JSON.parse(source);
  } catch {
    return undefined;
  }
  const tokens: string[] = [];
  JSON_TOKEN.lastIndex = 0;
  for (let match = JSON_TOKEN.exec(source); match; match = JSON_TOKEN.exec(source)) {
    tokens.push(match[1]);
  }
  const color = source.length <= COLOR_LIMIT;
  const span = (kind: string, token: string) =>
    color ? `<span class="nl-json-${kind}">${escapeHtml(token)}</span>` : escapeHtml(token);
  const newline = (depth: number) => `\n${'  '.repeat(depth)}`;
  let html = '';
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token) {
      case '{':
      case '[': {
        const close = token === '{' ? '}' : ']';
        if (tokens[i + 1] === close) {
          html += token + close;
          i++;
        } else {
          depth++;
          html += token + newline(depth);
        }
        break;
      }
      case '}':
      case ']':
        depth--;
        html += newline(depth) + token;
        break;
      case ',':
        html += `,${newline(depth)}`;
        break;
      case ':':
        html += ': ';
        break;
      default:
        if (token.startsWith('"')) {
          html += span(tokens[i + 1] === ':' ? 'key' : 'string', token);
        } else if (token === 'true' || token === 'false' || token === 'null') {
          html += span('literal', token);
        } else {
          html += span('number', token);
        }
    }
  }
  return html;
}

/** Bytes per line of a hex dump: eight fit the panel beside the grid. */
const DUMP_WIDTH = 8;

/** Bytes given as hex, as bytes. */
export function hexBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Bytes given as hex, laid out as hex editors do: offset, bytes, and the printable ones. */
export function hexDump(hex: string): string {
  const all = hexBytes(hex);
  const lines: string[] = [];
  for (let offset = 0; offset < all.length; offset += DUMP_WIDTH) {
    const bytes = [...all.subarray(offset, offset + DUMP_WIDTH)];
    const cells = Array.from({ length: DUMP_WIDTH }, (_, i) =>
      i < bytes.length ? bytes[i].toString(16).padStart(2, '0') : '  ',
    );
    const text = bytes.map((byte) =>
      byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.',
    );
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${cells.join(' ')}  ${text.join('')}`);
  }
  return lines.join('\n');
}
