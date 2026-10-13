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
} as const;
