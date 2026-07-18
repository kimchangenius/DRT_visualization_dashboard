import app.config as cfg

from app.vehicle_status import VehicleStatus, VEHICLE_STATUS_NUM_CLASSES


class Vehicle:
    def __init__(self, veh_id, curr_node, network):
        self.id = veh_id        # 0부터 N-1까지 값을 가짐
        self.network = network

        self.status = VehicleStatus.IDLE
        self.curr_node = curr_node
        self.next_node = 0
        self.active_request_list = []
        self.target_request = None
        self.target_arrival_time = -1
        self.num_passengers = 0

        # Logging
        self.num_accept = 0
        self.num_serve = 0
        self.idle_time = 0
        self.on_service_driving_time = 0
        self.total_distance = 0.0
        self.movement_history = []

        # Active network route
        self.route_nodes = []
        self.route_edges = []
        self.route_started_at = None
        self.route_distance_at_start = 0.0
        self.route_total_distance = 0.0
        self.route_total_duration = 0.0
        self.route_distance_travelled = 0.0
        self.route_progress = 0.0
        self.current_edge_index = None
        self.current_edge_progress = 0.0
        self.route_movement_type = None
        self.route_request_id = None

    def __str__(self):
        return (f"[V](id={self.id} / "
                f"{self.curr_node} -> {self.next_node} / "
                f"target_r={self.target_request.id if self.target_request else 'None'} / "
                f"status={self.status} / "
                f"at={self.target_arrival_time} / "
                f"np={self.num_passengers} / "
                f"active_r_num={len(self.active_request_list)})"
                )

    def get_static_features(self):
        """노드 정보를 뺀 차량의 작은 raw feature 벡터.
        status one-hot(4) + capacity(1) = VEHICLE_RAW_DIM=5"""
        vec_status = [0] * VEHICLE_STATUS_NUM_CLASSES
        if 1 <= self.status <= VEHICLE_STATUS_NUM_CLASSES:
            vec_status[self.status - 1] = 1
        vec_capa = [(cfg.VEH_CAPACITY - self.num_passengers) / cfg.VEH_CAPACITY]
        return vec_status + vec_capa

    def get_node_ids(self):
        """노드 ID 튜플 (curr_node, next_node). 노드는 1..NUM_NODES, 0은 'no node'."""
        curr = self.curr_node if 1 <= self.curr_node <= cfg.NUM_NODES else 0
        nxt = self.next_node if 1 <= self.next_node <= cfg.NUM_NODES else 0
        return [curr, nxt]

    def begin_route(self, target_node, start_time, movement_type, request_id):
        self.route_nodes = self.network.get_shortest_route(
            self.curr_node,
            target_node,
        )
        self.route_edges = self.network.get_route_edges(self.route_nodes)
        self.route_started_at = float(start_time)
        self.route_distance_at_start = self.total_distance
        self.route_total_distance = sum(
            edge['distance'] for edge in self.route_edges
        )
        self.route_total_duration = sum(
            edge['travel_time'] for edge in self.route_edges
        )
        self.route_distance_travelled = 0.0
        self.route_progress = 0.0
        self.current_edge_index = 0 if self.route_edges else None
        self.current_edge_progress = 0.0
        self.route_movement_type = movement_type
        self.route_request_id = request_id
        self.update_route_progress(start_time)
        return self.route_total_duration

    def update_route_progress(self, current_time):
        if self.route_started_at is None:
            return

        elapsed = max(
            0.0,
            min(
                float(current_time) - self.route_started_at,
                self.route_total_duration,
            ),
        )
        remaining = elapsed
        distance_travelled = 0.0
        current_edge_index = None
        current_edge_progress = 0.0

        for index, edge in enumerate(self.route_edges):
            duration = edge['travel_time']
            if remaining >= duration:
                distance_travelled += edge['distance']
                remaining -= duration
                if index == len(self.route_edges) - 1:
                    current_edge_index = index
                    current_edge_progress = 1.0
                continue

            current_edge_index = index
            current_edge_progress = remaining / duration
            distance_travelled += edge['distance'] * current_edge_progress
            break

        self.route_distance_travelled = min(
            distance_travelled,
            self.route_total_distance,
        )
        self.route_progress = (
            self.route_distance_travelled / self.route_total_distance
            if self.route_total_distance > 0
            else 1.0
        )
        self.current_edge_index = current_edge_index
        self.current_edge_progress = current_edge_progress
        self.total_distance = (
            self.route_distance_at_start + self.route_distance_travelled
        )

    def finish_route(self, current_time, end_reason):
        if self.route_started_at is None:
            return

        self.movement_history.append(
            self._movement_snapshot(current_time, end_reason)
        )
        self._clear_route()

    def active_movement_snapshot(self, current_time):
        if self.route_started_at is None:
            return None
        return self._movement_snapshot(current_time, 'in_progress')

    def _movement_snapshot(self, current_time, end_reason):
        self.update_route_progress(current_time)
        remaining = max(
            0.0,
            min(
                float(current_time) - self.route_started_at,
                self.route_total_duration,
            ),
        )
        encoded_edges = []
        for edge in self.route_edges:
            edge_progress = min(1.0, remaining / edge['travel_time'])
            encoded_edges.append({
                'from_node_id': edge['from'],
                'to_node_id': edge['to'],
                'travel_time': edge['travel_time'],
                'distance': edge['distance'],
                'distance_travelled': edge['distance'] * edge_progress,
            })
            remaining = max(0.0, remaining - edge['travel_time'])
        return {
            'movement_type': self.route_movement_type,
            'request_id': self.route_request_id,
            'start_time': self.route_started_at,
            'end_time': float(current_time),
            'scheduled_end_time': (
                self.route_started_at + self.route_total_duration
            ),
            'end_reason': end_reason,
            'route_node_ids': list(self.route_nodes),
            'edges': encoded_edges,
            'planned_distance': self.route_total_distance,
            'travelled_distance': self.route_distance_travelled,
            'cumulative_distance': self.total_distance,
        }

    def _clear_route(self):
        self.route_nodes = []
        self.route_edges = []
        self.route_started_at = None
        self.route_distance_at_start = self.total_distance
        self.route_total_distance = 0.0
        self.route_total_duration = 0.0
        self.route_distance_travelled = 0.0
        self.route_progress = 0.0
        self.current_edge_index = None
        self.current_edge_progress = 0.0
        self.route_movement_type = None
        self.route_request_id = None
