const paths = {
  copy: ['M9 9h11v11H9z', 'M15 9V4H4v11h5'],
  edit: ['m15 5 4 4', 'M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z'],
  regenerate: ['M20 7v5h-5', 'M4 17v-5h5', 'M6 7a7 7 0 0 1 12-2l2 3', 'M18 17a7 7 0 0 1-12 2l-2-3'],
  branch: ['M6 4v12a4 4 0 0 0 8 0v-5a4 4 0 0 1 4-4h2', 'm17 4 3 3-3 3'],
  volume: ['M4 9h4l5-4v14l-5-4H4z', 'M17 8a6 6 0 0 1 0 8', 'M20 5a10 10 0 0 1 0 14'],
  stop: ['M6 6h12v12H6z'],
  delete: ['M3 6h18', 'M9 6V3h6v3', 'm5 6 1 15h12l1-15', 'M10 10v7', 'M14 10v7'],
};

export function actionIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
  for (const d of paths[name] || []) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d); svg.appendChild(path);
  }
  return svg;
}
