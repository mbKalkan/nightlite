// Inline 16px icons drawn with currentColor so they follow the VS Code theme.

const svg = (body: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  database: svg(
    '<ellipse cx="8" cy="3.75" rx="5" ry="1.75"/><path d="M3 3.75v8.5c0 1 2.2 1.75 5 1.75s5-.75 5-1.75v-8.5M3 8c0 1 2.2 1.75 5 1.75S13 9 13 8"/>',
  ),
  table: svg(
    '<rect x="2.5" y="3" width="11" height="10" rx="1"/><path d="M2.5 6.5h11M2.5 9.75h11M6.5 6.5V13"/>',
  ),
  view: svg(
    '<path d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  ),
  index: svg(
    '<circle cx="5" cy="11" r="2.5"/><path d="M6.8 9.2 13 3M10.5 5.5 12 7M12 4l1.5 1.5"/>',
  ),
  trigger: svg('<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z"/>'),
  chevronDown: svg('<path d="M3.5 6 8 10.5 12.5 6"/>'),
  copy: svg(
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  ),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  panelRight: svg('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M9.5 3v10"/>'),
  tiles: svg(
    '<rect x="2" y="2" width="5" height="5" rx=".5"/><rect x="9" y="2" width="5" height="5" rx=".5"/><rect x="2" y="9" width="5" height="5" rx=".5"/><rect x="9" y="9" width="5" height="5" rx=".5"/>',
  ),
  arrowLeft: svg('<path d="M13 8H3M7 4 3 8l4 4"/>'),
  arrowRight: svg('<path d="M3 8h10M9 4l4 4-4 4"/>'),
  arrowUp: svg('<path d="M8 13V3M4 7l4-4 4 4"/>'),
  arrowDown: svg('<path d="M8 3v10M4 9l4 4 4-4"/>'),
  zoomIn: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M5 7h4M7 5v4"/>'),
  metadata: svg('<path d="M3 4h2M7 4h6M3 8h2M7 8h6M3 12h2M7 12h4"/>'),
  query: svg('<path d="M3 4.5 6.5 8 3 11.5M8.5 12H13"/>'),
  sort: svg('<path d="M5 13V3M2.5 5.5 5 3l2.5 2.5M11 3v10M8.5 10.5 11 13l2.5-2.5"/>'),
  filter: svg('<path d="M2 3h12L9.5 8.5V13l-3-1.5v-3z"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>'),
  save: svg('<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>'),
  zoomOut: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M5 7h4"/>'),
} as const;
