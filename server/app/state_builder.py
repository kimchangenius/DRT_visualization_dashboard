from datetime import datetime, timezone

import app.config as cfg
from app.vehicle_status import VehicleStatus
from app.request_status import RequestStatus


STATUS_MAP_VEH = {
    VehicleStatus.IDLE: 'idle',
    VehicleStatus.REJECT: 'idle',
    VehicleStatus.PICKUP: 'picking_up',
    VehicleStatus.DROPOFF: 'carrying',
}

STATUS_MAP_REQ = {
    RequestStatus.PENDING: 'waiting',
    RequestStatus.ACCEPTED: 'waiting',
    RequestStatus.PICKEDUP: 'picked_up',
    RequestStatus.SERVED: 'delivered',
    RequestStatus.CANCELLED: 'cancelled',
}


def _request_units(request):
    units = getattr(request, 'num_passengers', 1)
    return int(units) if isinstance(units, (int, float)) and units > 0 else 1


def _sum_request_units(requests):
    return sum(_request_units(request) for request in requests)


def sim_config_payload(config=None, max_num_request=None):
    config = cfg.DEFAULT_MODEL_CONFIG if config is None else config
    max_num_request = 0 if max_num_request is None else max_num_request
    return {
        'maxNumVehicles': cfg.MAX_NUM_VEHICLES,
        'vehCapacity': cfg.VEH_CAPACITY,
        'maxNumRequest': max_num_request,
        'maxWaitTime': cfg.MAX_WAIT_TIME,
        'hiddenDim': config.get('hidden_dim'),
        'batchSize': config.get('batch_size'),
        'learningRate': config.get('learning_rate'),
        'selectedScenario': config.get('scenario', 'S1'),
        'availableScenarios': config.get('available_scenarios', ['S1', 'S2', 'S3', 'S4']),
        'scenarioSeed': config.get('scenario_seed', 0),
        'modelWeightFile': config.get('model_weight_file'),
    }


def extract_vehicle(v, environment):
    status_str = STATUS_MAP_VEH.get(v.status, 'idle')

    is_moving = (
        v.status in (VehicleStatus.PICKUP, VehicleStatus.DROPOFF)
        and v.next_node > 0
    )
    if is_moving:
        v.update_route_progress(environment.curr_time)

    return {
        'id': v.id + 1,
        'currentNodeId': v.curr_node,
        'targetNodeId': v.next_node if v.next_node > 0 else None,
        'path': list(v.route_nodes) if is_moving else [],
        'pathProgress': round(v.route_progress, 6) if is_moving else 0,
        'currentEdgeIndex': v.current_edge_index if is_moving else None,
        'currentEdgeProgress': (
            round(v.current_edge_progress, 6) if is_moving else 0
        ),
        'routeDistance': (
            round(v.route_total_distance, 6) if is_moving else 0
        ),
        'routeDistanceTravelled': (
            round(v.route_distance_travelled, 6) if is_moving else 0
        ),
        'status': status_str,
        'passengerId': v.target_request.id if v.target_request else None,
        'numPassengers': int(getattr(v, 'num_passengers', 0)),
        'totalTrips': v.num_serve,
        'totalDistance': round(v.total_distance, 6),
    }


def _request_cancellation_time(r):
    cancel_at = getattr(r, 'cancel_at', None)
    if cancel_at is not None:
        return cancel_at
    if r.status == RequestStatus.CANCELLED and r.waiting_time is not None and r.waiting_time >= 0:
        return r.request_time + r.waiting_time
    return None


def extract_passenger(r):
    return {
        'id': r.id,
        'originNodeId': r.from_node_id,
        'destinationNodeId': r.to_node_id,
        'directTravelTime': r.travel_time,
        'numPassengers': _request_units(r),
        'requestTime': r.request_time,
        'pickupTime': r.pickup_at,
        'deliveryTime': r.dropoff_at,
        'cancellationTime': _request_cancellation_time(r),
        'assignmentTime': getattr(r, 'assignment_at', None),
        'cancellationReason': getattr(r, 'cancellation_reason', None),
        'cancellationDiagnostics': getattr(r, 'cancellation_diagnostics', None),
        'feasibilityHistory': list(getattr(r, 'feasibility_history', []) or []),
        'status': STATUS_MAP_REQ.get(r.status, 'waiting'),
        'assignedVehicleId': (r.assigned_v_id + 1) if r.assigned_v_id >= 0 else None,
    }


def compute_metrics(environment):
    served = [r for r in environment.done_request_list if r.status == RequestStatus.SERVED]
    waiting = [
        r for r in environment.active_request_list
        if r.status in (RequestStatus.PENDING, RequestStatus.ACCEPTED)
    ]
    in_transit = [
        r for r in environment.active_request_list
        if r.status == RequestStatus.PICKEDUP
    ]
    busy = [
        v for v in environment.vehicle_list
        if v.status not in (VehicleStatus.IDLE, VehicleStatus.REJECT)
    ]
    cancelled = [
        r for r in environment.done_request_list
        if r.status == RequestStatus.CANCELLED
    ]
    served_units = _sum_request_units(served)
    waiting_units = _sum_request_units(waiting)
    in_transit_units = _sum_request_units(in_transit)
    cancelled_units = _sum_request_units(cancelled)

    avg_wait = 0.0
    if served_units:
        avg_wait = sum(r.waiting_time * _request_units(r) for r in served) / served_units

    avg_travel = 0.0
    if served_units:
        avg_travel = sum(r.in_vehicle_time * _request_units(r) for r in served) / served_units

    util = round(len(busy) / len(environment.vehicle_list) * 100) if environment.vehicle_list else 0

    return {
        'currentTime': environment.curr_time,
        'totalPassengersServed': served_units,
        'totalPassengersWaiting': waiting_units,
        'totalPassengersInTransit': in_transit_units,
        'averageWaitTime': round(avg_wait, 1),
        'averageTravelTime': round(avg_travel, 1),
        'vehicleUtilization': util,
        'cancelCount': cancelled_units,
        'activeVehicles': len(busy),
        'totalVehicles': len(environment.vehicle_list),
    }


def compute_request_status(environment):
    served = sum(1 for r in environment.done_request_list if r.status == RequestStatus.SERVED)
    in_transit = sum(1 for r in environment.active_request_list if r.status == RequestStatus.PICKEDUP)
    waiting = sum(
        1 for r in environment.active_request_list
        if r.status in (RequestStatus.PENDING, RequestStatus.ACCEPTED)
    )
    cancelled = sum(1 for r in environment.done_request_list if r.status == RequestStatus.CANCELLED)
    return [
        {'name': 'Served', 'value': served, 'color': '#10b981'},
        {'name': 'In vehicle', 'value': in_transit, 'color': '#3b82f6'},
        {'name': 'Waiting', 'value': waiting, 'color': '#f59e0b'},
        {'name': 'Cancelled', 'value': cancelled, 'color': '#ef4444'},
    ]


def append_history_sample(environment, utilization_history, passenger_history, limit=200):
    metrics = compute_metrics(environment)
    utilization_history.append({
        'time': environment.curr_time,
        'utilization': metrics['vehicleUtilization'],
    })
    if len(utilization_history) > limit:
        utilization_history.pop(0)

    passenger_history.append({
        'time': environment.curr_time,
        'served': metrics['totalPassengersServed'],
        'waiting': metrics['totalPassengersWaiting'],
        'cancelled': metrics['cancelCount'],
    })
    if len(passenger_history) > limit:
        passenger_history.pop(0)
    return metrics


def build_state(
    environment, utilization_history=None, passenger_history=None, config=None,
    metrics=None, include_live_series=True,
):
    utilization_history = utilization_history or []
    passenger_history = passenger_history or []

    metrics = metrics or compute_metrics(environment)
    max_num_request = len(getattr(environment, 'original_request_list', []) or [])

    active_passengers = [
        extract_passenger(r) for r in environment.active_request_list
        if r.status in (RequestStatus.PENDING, RequestStatus.ACCEPTED, RequestStatus.PICKEDUP)
    ]
    served_passengers = [
        extract_passenger(r) for r in environment.done_request_list
        if r.status == RequestStatus.SERVED
    ]
    cancelled_passengers = [
        extract_passenger(r) for r in environment.done_request_list
        if r.status == RequestStatus.CANCELLED
    ]
    visible_passengers = active_passengers + served_passengers + cancelled_passengers

    return {
        'metrics': metrics,
        **sim_config_payload(config, max_num_request=max_num_request),
        'vehicles': [extract_vehicle(v, environment) for v in environment.vehicle_list],
        'passengers': visible_passengers,
        'vehicleMovementEvents': encode_recent_vehicle_movements(environment),
        'dispatchDecisionEvents': encode_recent_dispatch_decisions(environment),
        'utilizationHistory': list(utilization_history) if include_live_series else [],
        'passengerHistory': list(passenger_history) if include_live_series else [],
        'requestStatusData': compute_request_status(environment) if include_live_series else [],
    }


def json_default(obj):
    if hasattr(obj, 'item'):
        return obj.item()
    if hasattr(obj, 'tolist'):
        return obj.tolist()
    raise TypeError(f'{type(obj).__name__} is not JSON serializable')


def encode_passenger_events(frames):
    latest_passengers = {}
    assigned_vehicle_by_request = {}
    ordered_frames = sorted(
        frames,
        key=lambda frame: frame.get('metrics', {}).get('currentTime', 0),
    )
    for frame in ordered_frames:
        for passenger in frame.get('passengers', []):
            request_id = passenger.get('id')
            if request_id is None:
                continue
            latest_passengers[request_id] = passenger
            assigned_vehicle_id = passenger.get('assignedVehicleId')
            if assigned_vehicle_id is not None:
                assigned_vehicle_by_request[request_id] = assigned_vehicle_id

    events = []
    for request_id, passenger in latest_passengers.items():
        vehicle_id = (
            passenger.get('assignedVehicleId')
            or assigned_vehicle_by_request.get(request_id)
        )
        if vehicle_id is None:
            continue
        passenger_count = passenger.get('numPassengers', 1)
        if not isinstance(passenger_count, (int, float)) or passenger_count <= 0:
            passenger_count = 1

        pickup_time = passenger.get('pickupTime')
        if pickup_time is not None:
            events.append({
                'time': pickup_time,
                'type': 'pickup',
                'vehicleId': vehicle_id,
                'passengerId': request_id,
                'passengerCount': int(passenger_count),
                'nodeId': passenger.get('originNodeId'),
            })
        delivery_time = passenger.get('deliveryTime')
        if delivery_time is not None:
            events.append({
                'time': delivery_time,
                'type': 'dropoff',
                'vehicleId': vehicle_id,
                'passengerId': request_id,
                'passengerCount': int(passenger_count),
                'nodeId': passenger.get('destinationNodeId'),
            })

    return sorted(events, key=lambda event: (
        event['time'],
        event['vehicleId'],
        event['passengerId'],
        0 if event['type'] == 'pickup' else 1,
    ))


def _encode_vehicle_movement(vehicle_id, movement):
    return {
        'vehicleId': vehicle_id,
        'requestId': movement['request_id'],
        'movementType': movement['movement_type'],
        'startTime': movement['start_time'],
        'endTime': movement['end_time'],
        'scheduledEndTime': movement['scheduled_end_time'],
        'endReason': movement['end_reason'],
        'routeNodeIds': list(movement['route_node_ids']),
        'edges': [
            {
                'fromNodeId': edge['from_node_id'],
                'toNodeId': edge['to_node_id'],
                'travelTime': edge['travel_time'],
                'distance': edge['distance'],
                'distanceTravelled': edge['distance_travelled'],
            }
            for edge in movement['edges']
        ],
        'plannedDistance': movement['planned_distance'],
        'travelledDistance': movement['travelled_distance'],
        'cumulativeDistance': movement['cumulative_distance'],
    }


def encode_vehicle_movements(environment):
    movements = []
    current_time = getattr(environment, 'curr_time', 0)
    for vehicle in getattr(environment, 'vehicle_list', []) or []:
        vehicle_movements = list(
            getattr(vehicle, 'movement_history', []) or []
        )
        active_movement = vehicle.active_movement_snapshot(current_time)
        if active_movement is not None:
            vehicle_movements.append(active_movement)
        movements.extend(
            _encode_vehicle_movement(vehicle.id + 1, movement)
            for movement in vehicle_movements
        )
    return sorted(
        movements,
        key=lambda movement: (
            movement['startTime'],
            movement['vehicleId'],
            movement['requestId'] or -1,
            movement['movementType'],
        ),
    )


def encode_recent_vehicle_movements(environment):
    current_time = float(getattr(environment, 'curr_time', 0))
    interval_start = max(0.0, current_time - 1.0)
    movements = []
    for vehicle in getattr(environment, 'vehicle_list', []) or []:
        for movement in getattr(vehicle, 'movement_history', []) or []:
            if interval_start <= movement['end_time'] <= current_time:
                movements.append(
                    _encode_vehicle_movement(vehicle.id + 1, movement)
                )
        active_movement = vehicle.active_movement_snapshot(current_time)
        if active_movement is not None:
            movements.append(
                _encode_vehicle_movement(vehicle.id + 1, active_movement)
            )
    return sorted(
        movements,
        key=lambda movement: (
            movement['endTime'],
            movement['vehicleId'],
            movement['requestId'],
            movement['movementType'],
        ),
    )


def encode_dispatch_decisions(environment):
    decisions = [
        {
            'time': decision['time'],
            'decisionRound': decision['decisionRound'],
            'vehicleId': decision['vehicleId'],
            'actionType': decision['actionType'],
            'requestId': decision['requestId'],
            'pickupCandidateRequestIds': list(
                decision['pickupCandidateRequestIds']
            ),
        }
        for decision in (getattr(environment, 'dispatch_decisions', None) or [])
    ]
    return sorted(
        decisions,
        key=lambda decision: (
            decision['time'],
            decision['decisionRound'],
            decision['vehicleId'],
        ),
    )


def encode_recent_dispatch_decisions(environment):
    current_time = float(getattr(environment, 'curr_time', 0))
    interval_start = max(0.0, current_time - 1.0)
    return [
        decision
        for decision in encode_dispatch_decisions(environment)
        if interval_start <= decision['time'] <= current_time
    ]


def build_simulation_replay_payload(
    environment, replay, config=None, run_name='inference', version=4,
    generated_at=None,
):
    if version != 4:
        raise ValueError('Replay version must be 4.')
    generated_at = generated_at or datetime.now(timezone.utc).isoformat()
    frames_by_time = {
        frame.get('metrics', {}).get('currentTime', index): frame
        for index, frame in enumerate(replay.get('frames', []))
    }
    frames = []
    for time in sorted(frames_by_time):
        frame = dict(frames_by_time[time])
        frame['vehicleMovementEvents'] = []
        frame['dispatchDecisionEvents'] = []
        frame['utilizationHistory'] = []
        frame['passengerHistory'] = []
        frame['requestStatusData'] = []
        frames.append(frame)
    payload = {
        'version': version,
        'generatedAt': generated_at,
        'runName': run_name,
        'config': sim_config_payload(
            config,
            max_num_request=len(getattr(environment, 'original_request_list', []) or []),
        ),
        'frames': frames,
    }
    payload['passengerEvents'] = encode_passenger_events(frames)
    payload['distanceUnit'] = 'network_distance_unit'
    payload['vehicleMovements'] = encode_vehicle_movements(environment)
    payload['dispatchDecisions'] = encode_dispatch_decisions(environment)
    return payload
