import csv
import heapq
import math

import numpy as np

import app.config as cfg
from app.network_data import load_link_travel_times, load_od_travel_times


class DRTNetwork:
    def __init__(self):
        self.num_nodes = 0
        self.od_dur_mat = None
        self.max_duration = -1
        self.edge_data = {}
        self.edge_adjacency = {}
        self._route_cache = {}

        # GAT용 인접행렬 (정적). NUM_NODES+1 크기 — index 0은 "no node" 센티넬.
        # edge_weight[i, j] = 1 / (1 + travel_time[i, j])  (가까울수록 높음)
        # 0번 노드와의 edge_weight = epsilon (정상 노드와 분리)
        self.edge_weight = None

    @staticmethod
    def _undirected_edge_key(from_node_id, to_node_id):
        return tuple(sorted((from_node_id, to_node_id)))

    def set_edge_data(self, link_list_path, distance_path):
        distances = {}
        with open(distance_path, newline='', encoding='utf-8-sig') as csvfile:
            for row in csv.DictReader(csvfile):
                from_node_id = int(row['From'])
                to_node_id = int(row['To'])
                distance = float(row['Distance'])
                if distance <= 0:
                    raise ValueError(
                        f'Edge distance must be positive: {from_node_id}->{to_node_id}'
                    )
                key = self._undirected_edge_key(from_node_id, to_node_id)
                if key in distances:
                    raise ValueError(f'Duplicate edge distance: {key[0]}-{key[1]}')
                distances[key] = distance

        edge_data = {}
        edge_adjacency = {}
        for link in load_link_travel_times(link_list_path):
            from_node_id = link['from']
            to_node_id = link['to']
            travel_time = link['travel_time']
            edge_key = (from_node_id, to_node_id)
            if edge_key in edge_data:
                raise ValueError(
                    f'Duplicate directed edge: {from_node_id}->{to_node_id}'
                )
            distance_key = self._undirected_edge_key(from_node_id, to_node_id)
            if distance_key not in distances:
                raise ValueError(
                    f'Missing edge distance: {from_node_id}->{to_node_id}'
                )
            edge = {
                'from': from_node_id,
                'to': to_node_id,
                'travel_time': travel_time,
                'distance': distances[distance_key],
            }
            edge_data[edge_key] = edge
            edge_adjacency.setdefault(from_node_id, []).append(edge)

        unused_distances = set(distances).difference(
            self._undirected_edge_key(*edge_key) for edge_key in edge_data
        )
        if unused_distances:
            formatted = ', '.join(f'{a}-{b}' for a, b in sorted(unused_distances))
            raise ValueError(f'Edge distance has no matching travel-time edge: {formatted}')

        for edges in edge_adjacency.values():
            edges.sort(key=lambda edge: edge['to'])
        self.edge_data = edge_data
        self.edge_adjacency = edge_adjacency
        self._route_cache.clear()
        if self.od_dur_mat is not None:
            self._validate_routes_against_od()

    def set_od_matrix(self, path):
        self.od_dur_mat = load_od_travel_times(path)
        self.num_nodes = len(self.od_dur_mat)
        if self.num_nodes != cfg.NUM_NODES:
            raise ValueError(
                f"OD data has {self.num_nodes} nodes but "
                f"cfg.NUM_NODES={cfg.NUM_NODES}"
            )
        self.max_duration = max(
            duration
            for destinations in self.od_dur_mat.values()
            for duration in destinations.values()
        )

        N = cfg.NUM_NODES
        ew = np.zeros((N + 1, N + 1), dtype=np.float32)
        # 노드 1..N (model 입장에선 index 1..N)
        for i in range(1, N + 1):
            for j in range(1, N + 1):
                dur = self.od_dur_mat[i][j]
                ew[i, j] = 1.0 / (1.0 + dur)
        # 0번(=no node) self-loop만 약하게
        ew[0, 0] = 1e-3
        self.edge_weight = ew
        if self.edge_data:
            self._validate_routes_against_od()

    def get_duration(self, from_node_id, to_node_id):
        return self.od_dur_mat[from_node_id][to_node_id]

    def get_shortest_route(self, from_node_id, to_node_id):
        if from_node_id == to_node_id:
            return [from_node_id]
        cache_key = (from_node_id, to_node_id)
        cached = self._route_cache.get(cache_key)
        if cached is not None:
            return list(cached)
        if from_node_id not in self.edge_adjacency:
            raise ValueError(f'Unknown route origin node: {from_node_id}')

        best = {from_node_id: (0.0, (from_node_id,))}
        queue = [(0.0, (from_node_id,), from_node_id)]
        while queue:
            duration, route, node_id = heapq.heappop(queue)
            if best.get(node_id) != (duration, route):
                continue
            if node_id == to_node_id:
                self._route_cache[cache_key] = route
                return list(route)
            for edge in self.edge_adjacency.get(node_id, []):
                next_duration = duration + edge['travel_time']
                next_route = route + (edge['to'],)
                previous = best.get(edge['to'])
                if previous is None or (next_duration, next_route) < previous:
                    best[edge['to']] = (next_duration, next_route)
                    heapq.heappush(
                        queue,
                        (next_duration, next_route, edge['to']),
                    )

        raise ValueError(f'No network route from {from_node_id} to {to_node_id}')

    def get_route_edges(self, route_node_ids):
        edges = []
        for index in range(len(route_node_ids) - 1):
            edge_key = (route_node_ids[index], route_node_ids[index + 1])
            edge = self.edge_data.get(edge_key)
            if edge is None:
                raise ValueError(
                    f'Route contains unknown edge: {edge_key[0]}->{edge_key[1]}'
                )
            edges.append(dict(edge))
        return edges

    def get_route_distance(self, from_node_id, to_node_id):
        route = self.get_shortest_route(from_node_id, to_node_id)
        return sum(edge['distance'] for edge in self.get_route_edges(route))

    def _validate_routes_against_od(self):
        if self.od_dur_mat is None or not self.edge_data:
            return
        expected_nodes = set(self.od_dur_mat)
        graph_nodes = set(self.edge_adjacency)
        graph_nodes.update(edge['to'] for edge in self.edge_data.values())
        if graph_nodes != expected_nodes:
            raise ValueError(
                'Edge graph nodes do not match OD matrix nodes: '
                f'graph={sorted(graph_nodes)}, od={sorted(expected_nodes)}'
            )

        for from_node_id in sorted(expected_nodes):
            for to_node_id in sorted(expected_nodes):
                route = self.get_shortest_route(from_node_id, to_node_id)
                route_duration = sum(
                    edge['travel_time']
                    for edge in self.get_route_edges(route)
                )
                od_duration = self.get_duration(from_node_id, to_node_id)
                if not math.isclose(route_duration, od_duration, abs_tol=1e-9):
                    raise ValueError(
                        'Shortest edge route does not match OD duration: '
                        f'{from_node_id}->{to_node_id}, '
                        f'route={route_duration}, od={od_duration}'
                    )
