import type { NetworkNode, NetworkLink } from '../types/simulation';

export const nodes: NetworkNode[] = [
  { id: 1, x: 0, y: 0, label: '1' },
  { id: 2, x: 150, y: 0, label: '2' },
  { id: 3, x: 0, y: 25, label: '3' },
  { id: 4, x: 50, y: 25, label: '4' },
  { id: 5, x: 100, y: 25, label: '5' },
  { id: 6, x: 150, y: 25, label: '6' },
  { id: 7, x: 200, y: 50, label: '7' },
  { id: 8, x: 150, y: 50, label: '8' },
  { id: 9, x: 100, y: 50, label: '9' },
  { id: 10, x: 100, y: 75, label: '10' },
  { id: 11, x: 50, y: 75, label: '11' },
  { id: 12, x: 0, y: 75, label: '12' },
  { id: 13, x: 0, y: 175, label: '13' },
  { id: 14, x: 50, y: 125, label: '14' },
  { id: 15, x: 100, y: 125, label: '15' },
  { id: 16, x: 150, y: 75, label: '16' },
  { id: 17, x: 150, y: 100, label: '17' },
  { id: 18, x: 200, y: 75, label: '18' },
  { id: 19, x: 150, y: 125, label: '19' },
  { id: 20, x: 150, y: 175, label: '20' },
  { id: 21, x: 100, y: 175, label: '21' },
  { id: 22, x: 100, y: 150, label: '22' },
  { id: 23, x: 50, y: 150, label: '23' },
  { id: 24, x: 50, y: 175, label: '24' },
];

let linkId = 0;
function link(from: number, to: number, dist: number, fft: number): NetworkLink {
  return { id: linkId++, from, to, distance: dist, freeFlowTime: fft };
}

export const links: NetworkLink[] = [
  link(1, 2, 6, 6), link(2, 1, 6, 6),
  link(1, 3, 4, 4), link(3, 1, 4, 4),
  link(2, 6, 5, 5), link(6, 2, 5, 5),
  link(3, 4, 4, 4), link(4, 3, 4, 4),
  link(3, 12, 4, 4), link(12, 3, 4, 4),
  link(4, 5, 2, 2), link(5, 4, 2, 2),
  link(4, 11, 6, 6), link(11, 4, 6, 6),
  link(5, 6, 2, 2), link(6, 5, 2, 2),
  link(5, 9, 5, 5), link(9, 5, 5, 5),
  link(6, 8, 2, 2), link(8, 6, 2, 2),
  link(7, 8, 3, 3), link(8, 7, 3, 3),
  link(7, 18, 2, 2), link(18, 7, 2, 2),
  link(8, 9, 10, 10), link(9, 8, 10, 10),
  link(8, 16, 5, 5), link(16, 8, 5, 5),
  link(9, 10, 3, 3), link(10, 9, 3, 3),
  link(10, 11, 5, 5), link(11, 10, 5, 5),
  link(10, 15, 6, 6), link(15, 10, 6, 6),
  link(10, 16, 4, 4), link(16, 10, 4, 4),
  link(10, 17, 8, 8), link(17, 10, 8, 8),
  link(11, 12, 6, 6), link(12, 11, 6, 6),
  link(11, 14, 4, 4), link(14, 11, 4, 4),
  link(12, 13, 3, 3), link(13, 12, 3, 3),
  link(13, 24, 4, 4), link(24, 13, 4, 4),
  link(14, 15, 5, 5), link(15, 14, 5, 5),
  link(14, 23, 4, 4), link(23, 14, 4, 4),
  link(15, 19, 3, 3), link(19, 15, 3, 3),
  link(15, 22, 3, 3), link(22, 15, 3, 3),
  link(16, 17, 2, 2), link(17, 16, 2, 2),
  link(16, 18, 3, 3), link(18, 16, 3, 3),
  link(17, 19, 2, 2), link(19, 17, 2, 2),
  link(18, 20, 4, 4), link(20, 18, 4, 4),
  link(19, 20, 4, 4), link(20, 19, 4, 4),
  link(20, 21, 6, 6), link(21, 20, 6, 6),
  link(20, 22, 5, 5), link(22, 20, 5, 5),
  link(21, 22, 2, 2), link(22, 21, 2, 2),
  link(21, 24, 3, 3), link(24, 21, 3, 3),
  link(22, 23, 4, 4), link(23, 22, 4, 4),
  link(23, 24, 2, 2), link(24, 23, 2, 2),
];

export const nodeMap = new Map(nodes.map(n => [n.id, n]));

export function getAdjacency(): Map<number, { to: number; distance: number }[]> {
  const adj = new Map<number, { to: number; distance: number }[]>();
  for (const node of nodes) {
    adj.set(node.id, []);
  }
  for (const l of links) {
    adj.get(l.from)!.push({ to: l.to, distance: l.distance });
  }
  return adj;
}

const fftAdj = new Map<number, { to: number; time: number }[]>();
for (const node of nodes) fftAdj.set(node.id, []);
for (const l of links) fftAdj.get(l.from)!.push({ to: l.to, time: l.freeFlowTime });

export function shortestTravelTime(from: number, to: number): number | null {
  if (from === to) return 0;
  const dist = new Map<number, number>();
  dist.set(from, 0);
  const pq: [number, number][] = [[0, from]];

  while (pq.length > 0) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, u] = pq.shift()!;
    if (d > (dist.get(u) ?? Infinity)) continue;
    if (u === to) return d;
    for (const edge of fftAdj.get(u) ?? []) {
      const nd = d + edge.time;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        pq.push([nd, edge.to]);
      }
    }
  }
  return null;
}
