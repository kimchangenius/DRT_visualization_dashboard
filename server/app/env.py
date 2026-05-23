"""Inference-only DRT environment for dashboard simulation."""
import copy

import numpy as np
import app.config as cfg

from app.action_type import ActionType
from app.request import Request
from app.request_status import RequestStatus
from app.vehicle import Vehicle
from app.vehicle_status import VehicleStatus


class RideSharingEnvironment:
    def __init__(self, network, original_request_list, vehicle_init_pos):
        self.network = network
        self.original_request_list = original_request_list
        self.vehicle_init_pos = vehicle_init_pos

        self.curr_time = None
        self.curr_step = None
        self.future_request_list = None
        self.active_request_list = None
        self.done_request_list = None
        self.vehicle_list = None

    def reset(self):
        self.curr_time = 0
        self.curr_step = 0
        self.future_request_list = copy.deepcopy(self.original_request_list)
        self.active_request_list = []
        self.done_request_list = []
        self.vehicle_list = []
        self.initialize_vehicles()
        self.handle_time_update(count_idle=False)
        return None

    def initialize_vehicles(self):
        for idx in range(cfg.MAX_NUM_VEHICLES):
            position = self.vehicle_init_pos[idx]
            self.vehicle_list.append(Vehicle(idx, position, self.network))

    @staticmethod
    def _remove_if_present(items, item):
        if item in items:
            items.remove(item)

    def handle_time_update(self, count_idle=True):
        while self.future_request_list and self.future_request_list[0].request_time <= self.curr_time:
            self.active_request_list.append(self.future_request_list.pop(0))

        for vehicle in self.vehicle_list:
            if vehicle.status == VehicleStatus.REJECT:
                vehicle.status = VehicleStatus.IDLE
            elif count_idle and vehicle.status == VehicleStatus.IDLE:
                vehicle.idle_time += 1

            if vehicle.status == VehicleStatus.PICKUP and vehicle.target_arrival_time == self.curr_time:
                self._finish_pickup(vehicle)

            if vehicle.status == VehicleStatus.DROPOFF and vehicle.target_arrival_time == self.curr_time:
                self._finish_dropoff(vehicle)

        self._update_active_requests()
        self._sync_request_slots()

    def _finish_pickup(self, vehicle):
        request = vehicle.target_request
        vehicle.status = VehicleStatus.IDLE
        vehicle.curr_node = vehicle.next_node
        vehicle.next_node = 0
        vehicle.target_request = None
        vehicle.target_arrival_time = -1

        if request.status == RequestStatus.CANCELLED:
            self._remove_if_present(vehicle.active_request_list, request)
            return

        vehicle.num_passengers += request.num_passengers
        assert 0 <= vehicle.num_passengers <= cfg.VEH_CAPACITY, 'Invalid Capacity'
        request.status = RequestStatus.PICKEDUP
        request.waiting_time = self.curr_time - request.request_time
        request.pickup_at = self.curr_time

    def _finish_dropoff(self, vehicle):
        request = vehicle.target_request
        vehicle.status = VehicleStatus.IDLE
        vehicle.curr_node = vehicle.next_node
        vehicle.next_node = 0
        vehicle.target_request = None
        vehicle.target_arrival_time = -1
        self._remove_if_present(vehicle.active_request_list, request)
        vehicle.num_passengers -= request.num_passengers
        assert 0 <= vehicle.num_passengers <= cfg.VEH_CAPACITY, 'Invalid Capacity'

        request.status = RequestStatus.SERVED
        request.arrival_due_left = max(0, request.arrival_due - self.curr_time)
        request.in_vehicle_time = self.curr_time - request.pickup_at
        request.dropoff_at = self.curr_time
        self._remove_if_present(self.active_request_list, request)
        self.done_request_list.append(request)
        vehicle.num_serve += 1

    def _update_active_requests(self):
        cancelled = []
        for request in self.active_request_list:
            request.arrival_due_left = max(0, request.arrival_due - self.curr_time)
            if request.status in (RequestStatus.PENDING, RequestStatus.ACCEPTED):
                request.waiting_time = self.curr_time - request.request_time
                if request.waiting_time >= cfg.MAX_WAIT_TIME:
                    request.status = RequestStatus.CANCELLED
                    request.cancel_at = self.curr_time
                    cancelled.append(request)
            elif request.status == RequestStatus.PICKEDUP:
                request.in_vehicle_time = self.curr_time - request.pickup_at

        for request in cancelled:
            self._clear_pickup_assignment(request)
            self._remove_if_present(self.active_request_list, request)
            self.done_request_list.append(request)

    def _clear_pickup_assignment(self, request):
        if request.assigned_v_id < 0:
            return
        for vehicle in self.vehicle_list:
            if (
                vehicle.id == request.assigned_v_id
                and vehicle.status == VehicleStatus.PICKUP
                and vehicle.target_request == request
            ):
                vehicle.status = VehicleStatus.IDLE
                vehicle.next_node = 0
                vehicle.target_request = None
                vehicle.target_arrival_time = -1
                self._remove_if_present(vehicle.active_request_list, request)
                return

    def _sync_request_slots(self):
        for idx, request in enumerate(self.active_request_list):
            request.slot_idx = idx

    def get_snapshot(self):
        vehicle_static = np.zeros((cfg.MAX_NUM_VEHICLES, cfg.VEHICLE_RAW_DIM), dtype=np.float32)
        vehicle_nodes = np.zeros((cfg.MAX_NUM_VEHICLES, 2), dtype=np.int32)
        for idx, vehicle in enumerate(self.vehicle_list[:cfg.MAX_NUM_VEHICLES]):
            vehicle_static[idx] = np.asarray(vehicle.get_static_features(), dtype=np.float32)
            vehicle_nodes[idx] = np.asarray(vehicle.get_node_ids(), dtype=np.int32)

        request_count = len(self.active_request_list)
        request_static = np.zeros((request_count, cfg.REQUEST_RAW_DIM), dtype=np.float32)
        request_nodes = np.zeros((request_count, 2), dtype=np.int32)
        for idx, request in enumerate(self.active_request_list):
            request_static[idx] = np.asarray(request.get_static_features(), dtype=np.float32)
            request_nodes[idx] = np.asarray(request.get_node_ids(), dtype=np.int32)

        last_request_time = max((r.request_time for r in self.original_request_list), default=0)
        span = float(max(
            last_request_time + Request.ARRIVAL_TOLERANCE_TIME + max(self.network.max_duration, 1),
            1,
        ))
        time_norm = np.float32(min(1.0, float(self.curr_time) / span))

        return {
            'vehicle_static': vehicle_static,
            'vehicle_nodes': vehicle_nodes,
            'request_static': request_static,
            'request_nodes': request_nodes,
            'time_norm': time_norm,
            'global_stats': self._global_stats(request_count),
            'pair_agg': self._pair_aggregate_scalars(time_norm),
        }

    def _global_stats(self, request_count):
        max_requests = float(max(len(self.original_request_list), 1))
        stats = np.zeros(cfg.GLOBAL_STATS_DIM, dtype=np.float32)
        stats[0] = np.float32(min(1.0, request_count / 32.0))
        stats[1] = np.float32(min(1.0, len(self.future_request_list) / max_requests))
        stats[2] = np.float32(
            sum(1 for v in self.vehicle_list if v.status == VehicleStatus.IDLE) / cfg.MAX_NUM_VEHICLES
        )
        pending = [r for r in self.active_request_list if r.status == RequestStatus.PENDING]
        if pending:
            stats[3] = np.float32(np.mean([r.waiting_time for r in pending]) / cfg.MAX_WAIT_TIME)
        cap_denom = max(cfg.VEH_CAPACITY * cfg.MAX_NUM_VEHICLES, 1)
        stats[4] = np.float32(sum(v.num_passengers for v in self.vehicle_list) / cap_denom)
        stats[5] = np.float32(
            sum(1 for v in self.vehicle_list if v.status == VehicleStatus.PICKUP) / cfg.MAX_NUM_VEHICLES
        )
        stats[6] = np.float32(
            sum(1 for v in self.vehicle_list if v.status == VehicleStatus.DROPOFF) / cfg.MAX_NUM_VEHICLES
        )
        stats[7] = np.float32(
            sum(1 for v in self.vehicle_list if v.status == VehicleStatus.REJECT) / cfg.MAX_NUM_VEHICLES
        )
        return stats

    def _pair_aggregate_scalars(self, time_norm_scalar):
        cap = float(max(getattr(cfg, 'PAIR_AGG_COUNT_NORM_CAP', 48), 1.0))
        due_denominator = float(max(self.network.max_duration + Request.ARRIVAL_TOLERANCE_TIME, 1.0))
        total_capacity = max(cfg.VEH_CAPACITY * cfg.MAX_NUM_VEHICLES, 1)

        pending = [r for r in self.active_request_list if r.status == RequestStatus.PENDING]
        picked = [r for r in self.active_request_list if r.status == RequestStatus.PICKEDUP]
        if pending:
            waits = [float(r.waiting_time) for r in pending]
            mean_wait = np.float32(np.mean(waits) / cfg.MAX_WAIT_TIME)
            max_wait = np.float32(min(1.0, np.max(waits) / cfg.MAX_WAIT_TIME))
            dues = [float(max(0, r.arrival_due_left)) for r in pending]
            mean_due = np.float32(np.mean(dues) / due_denominator)
        else:
            mean_wait = max_wait = mean_due = np.float32(0.0)

        out = np.array([
            sum(1 for v in self.vehicle_list if v.status == VehicleStatus.IDLE) / cfg.MAX_NUM_VEHICLES,
            len(pending) / cap,
            len(picked) / cap,
            mean_wait,
            max_wait,
            mean_due,
            min(1.0, float(time_norm_scalar)),
            sum(v.num_passengers for v in self.vehicle_list) / total_capacity,
            min(1.0, len(self.future_request_list) / max(len(self.original_request_list), 1)),
            len(self.active_request_list) / cap,
        ], dtype=np.float32)
        assert out.shape == (cfg.PAIR_AGG_DIM,), 'PAIR_AGG_DIM mismatch'
        return out

    def _onboard_requests(self, vehicle):
        return [r for r in vehicle.active_request_list if r.status == RequestStatus.PICKEDUP]

    def _request_travel_time(self, request):
        travel_time = getattr(request, 'travel_time', None)
        if travel_time is None or travel_time < 0:
            travel_time = self.network.get_duration(request.from_node_id, request.to_node_id)
        return float(travel_time)

    def _all_within_in_vehicle_limits(self, elapsed_by_request):
        return all(
            float(elapsed) <= self.in_vehicle_time_limit(request)
            for request, elapsed in elapsed_by_request.items()
        )

    def _has_feasible_dropoff_sequence(self, start_node, elapsed_by_request):
        if not elapsed_by_request:
            return True
        if not self._all_within_in_vehicle_limits(elapsed_by_request):
            return False

        requests = tuple(elapsed_by_request.keys())
        limits = {request: self.in_vehicle_time_limit(request) for request in requests}
        memo = {}

        def search(curr_node, remaining, elapsed_values):
            if not remaining:
                return True
            key = (
                curr_node,
                tuple(request.id for request in remaining),
                tuple(float(value) for value in elapsed_values),
            )
            if key in memo:
                return memo[key]

            drop_order = sorted(
                range(len(remaining)),
                key=lambda idx: limits[remaining[idx]] - (
                    float(elapsed_values[idx])
                    + float(self.network.get_duration(curr_node, remaining[idx].to_node_id))
                ),
            )
            for idx in drop_order:
                request = remaining[idx]
                duration = self.network.get_duration(curr_node, request.to_node_id)
                next_elapsed = tuple(float(value) + float(duration) for value in elapsed_values)
                if any(next_elapsed[j] > limits[remaining[j]] for j in range(len(remaining))):
                    continue
                next_remaining = remaining[:idx] + remaining[idx + 1:]
                next_elapsed_remaining = next_elapsed[:idx] + next_elapsed[idx + 1:]
                if search(request.to_node_id, next_remaining, next_elapsed_remaining):
                    memo[key] = True
                    return True

            memo[key] = False
            return False

        elapsed_values = tuple(float(elapsed_by_request[request]) for request in requests)
        return search(start_node, requests, elapsed_values)

    def _can_serve_after_pickup(self, vehicle, request, pickup_duration):
        onboard = self._onboard_requests(vehicle)
        if not onboard:
            direct_duration = self.network.get_duration(request.from_node_id, request.to_node_id)
            return direct_duration <= self.in_vehicle_time_limit(request)

        elapsed = {r: float(r.in_vehicle_time) + float(pickup_duration) for r in onboard}
        elapsed[request] = 0.0
        return self._has_feasible_dropoff_sequence(request.from_node_id, elapsed)

    def _can_dropoff_next(self, vehicle, request, dropoff_duration):
        onboard = self._onboard_requests(vehicle)
        elapsed = {r: float(r.in_vehicle_time) + float(dropoff_duration) for r in onboard}
        if not self._all_within_in_vehicle_limits(elapsed):
            return False
        elapsed.pop(request, None)
        return self._has_feasible_dropoff_sequence(request.to_node_id, elapsed)

    def _can_wait_with_onboard_limits(self, vehicle, wait_time=1.0):
        elapsed = {r: float(r.in_vehicle_time) + float(wait_time) for r in self._onboard_requests(vehicle)}
        return self._has_feasible_dropoff_sequence(vehicle.curr_node, elapsed)

    def enumerate_pair_candidates(self, idle_vehicles, include_wait=True):
        result = {}
        zero_r = np.zeros(cfg.REQUEST_RAW_DIM, dtype=np.float32)
        zero_rel = np.zeros(cfg.RELATION_INPUT_DIM, dtype=np.float32)
        max_duration = self.network.max_duration

        for vehicle in idle_vehicles:
            candidates = []
            fallback_dropoff_candidates = []
            vehicle_features = np.array(vehicle.get_static_features(), dtype=np.float32)

            for slot_idx, request in enumerate(self.active_request_list):
                if request.status == RequestStatus.PENDING:
                    candidate = self._pickup_candidate(
                        vehicle, request, slot_idx, vehicle_features, max_duration
                    )
                    if candidate is not None:
                        candidates.append(candidate)
                elif request.status == RequestStatus.PICKEDUP and request.assigned_v_id == vehicle.id:
                    candidate = self._dropoff_candidate(
                        vehicle, request, slot_idx, vehicle_features, max_duration
                    )
                    if candidate is None:
                        continue
                    if candidate.pop('is_fallback'):
                        fallback_dropoff_candidates.append(candidate)
                    else:
                        candidates.append(candidate)

            if not any(candidate.get('is_real', 0) for candidate in candidates):
                candidates.extend(fallback_dropoff_candidates)

            if include_wait and self._can_wait_with_onboard_limits(vehicle):
                candidates.append({
                    'v_idx': vehicle.id,
                    'r': None,
                    'r_slot_idx': 0,
                    'action_type': ActionType.REJECT,
                    'is_reject': 1,
                    'is_real': 0,
                    'v_feat': vehicle_features,
                    'r_feat': zero_r,
                    'rel_feat': zero_rel,
                })
            result[vehicle.id] = candidates
        return result

    def _pickup_candidate(self, vehicle, request, slot_idx, vehicle_features, max_duration):
        if cfg.VEH_CAPACITY - vehicle.num_passengers < request.num_passengers:
            return None
        pickup_duration = self.network.get_duration(vehicle.curr_node, request.from_node_id)
        if request.waiting_time + pickup_duration >= cfg.MAX_WAIT_TIME:
            return None
        if not self._can_serve_after_pickup(vehicle, request, pickup_duration):
            return None
        return {
            'v_idx': vehicle.id,
            'r': request,
            'r_slot_idx': slot_idx,
            'action_type': ActionType.PICKUP,
            'is_reject': 0,
            'is_real': 1,
            'v_feat': vehicle_features,
            'r_feat': np.array(request.get_static_features(), dtype=np.float32),
            'rel_feat': np.array([0.0, pickup_duration / max_duration if max_duration > 0 else 0.0], dtype=np.float32),
        }

    def _dropoff_candidate(self, vehicle, request, slot_idx, vehicle_features, max_duration):
        dropoff_duration = self.network.get_duration(vehicle.curr_node, request.to_node_id)
        return {
            'v_idx': vehicle.id,
            'r': request,
            'r_slot_idx': slot_idx,
            'action_type': ActionType.DROPOFF,
            'is_reject': 0,
            'is_real': 1,
            'is_fallback': not self._can_dropoff_next(vehicle, request, dropoff_duration),
            'v_feat': vehicle_features,
            'r_feat': np.array(request.get_static_features(), dtype=np.float32),
            'rel_feat': np.array([1.0, dropoff_duration / max_duration if max_duration > 0 else 0.0], dtype=np.float32),
        }

    def step(self, action):
        vehicle = self.vehicle_list[action['vehicle_idx']]
        action_type = action['action_type']
        request = action['request']

        if action_type == ActionType.REJECT:
            vehicle.status = VehicleStatus.REJECT
            vehicle.idle_time += 1
        elif action_type == ActionType.PICKUP:
            self._start_pickup(vehicle, request)
        elif action_type == ActionType.DROPOFF:
            self._start_dropoff(vehicle, request)
        else:
            raise ValueError(f'Unknown action_type: {action_type}')

        self._sync_request_slots()
        self.curr_step += 1

    def _start_pickup(self, vehicle, request):
        assert request is not None and request.status == RequestStatus.PENDING, 'Invalid PICKUP target'
        vehicle.status = VehicleStatus.PICKUP
        vehicle.active_request_list.append(request)
        vehicle.next_node = request.from_node_id
        vehicle.target_request = request
        pickup_duration = self.network.get_duration(vehicle.curr_node, vehicle.next_node)
        vehicle.target_arrival_time = self.curr_time + pickup_duration

        request.status = RequestStatus.ACCEPTED
        request.assigned_v_id = vehicle.id
        vehicle.num_accept += 1

        if vehicle.curr_node == vehicle.next_node:
            vehicle.status = VehicleStatus.IDLE
            vehicle.next_node = 0
            vehicle.target_request = None
            vehicle.target_arrival_time = -1
            vehicle.num_passengers += request.num_passengers
            assert 0 <= vehicle.num_passengers <= cfg.VEH_CAPACITY, 'Invalid Capacity'
            request.status = RequestStatus.PICKEDUP
            request.waiting_time = self.curr_time - request.request_time
            request.pickup_at = self.curr_time

    def _start_dropoff(self, vehicle, request):
        assert request is not None and request in vehicle.active_request_list, 'Invalid DROPOFF target'
        vehicle.status = VehicleStatus.DROPOFF
        vehicle.next_node = request.to_node_id
        vehicle.target_request = request
        dropoff_duration = self.network.get_duration(vehicle.curr_node, vehicle.next_node)
        vehicle.target_arrival_time = self.curr_time + dropoff_duration

        if vehicle.curr_node == vehicle.next_node:
            vehicle.status = VehicleStatus.IDLE
            vehicle.next_node = 0
            vehicle.target_request = None
            vehicle.target_arrival_time = -1
            self._remove_if_present(vehicle.active_request_list, request)
            vehicle.num_passengers -= request.num_passengers
            assert 0 <= vehicle.num_passengers <= cfg.VEH_CAPACITY, 'Invalid Capacity'

            request.status = RequestStatus.SERVED
            request.arrival_due_left = max(0, request.arrival_due - self.curr_time)
            request.in_vehicle_time = self.curr_time - request.pickup_at
            request.dropoff_at = self.curr_time
            self._remove_if_present(self.active_request_list, request)
            self.done_request_list.append(request)
            vehicle.num_serve += 1

    def has_idle_vehicle(self):
        return any(vehicle.status == VehicleStatus.IDLE for vehicle in self.vehicle_list)

    def in_vehicle_time_limit(self, request):
        return self._request_travel_time(request) + float(cfg.MAX_INVEHICLE_TIME)

    def is_done(self):
        has_busy_vehicle = any(
            vehicle.status not in (VehicleStatus.IDLE, VehicleStatus.REJECT)
            for vehicle in self.vehicle_list
        )
        return (
            len(self.active_request_list) == 0
            and len(self.future_request_list) == 0
            and not has_busy_vehicle
        )
