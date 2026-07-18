import glob
import os

from app.action_type import ActionType
from app.vehicle_status import VehicleStatus


def resolve_model_path(data_path, result_path, model_filename):
    configured_path = os.environ.get('DRT_MODEL_PATH')
    if configured_path:
        return configured_path

    for path in (
        os.path.join(data_path, model_filename),
        os.path.join(result_path, model_filename),
    ):
        if os.path.exists(path):
            return path

    for directory in (data_path, result_path):
        weight_files = [
            path
            for path in glob.glob(os.path.join(directory, '*.h5'))
            if os.path.isfile(path)
        ]
        if weight_files:
            return max(weight_files, key=os.path.getmtime)

    return os.path.join(data_path, model_filename)


def dispatch_idle_vehicles(environment, agent):
    decisions_at_current_time = [
        decision
        for decision in (getattr(environment, 'dispatch_decisions', None) or [])
        if decision.get('time') == environment.curr_time
    ]
    decision_round = (
        max(decision['decisionRound'] for decision in decisions_at_current_time) + 1
        if decisions_at_current_time
        else 0
    )

    while environment.has_idle_vehicle():
        idle_vehicles = [
            vehicle
            for vehicle in environment.vehicle_list
            if vehicle.status == VehicleStatus.IDLE
        ]
        if not idle_vehicles:
            break

        candidates_by_vehicle = environment.enumerate_pair_candidates(
            idle_vehicles,
            include_wait=True,
        )
        has_real_candidate = any(
            candidate.get('is_real', 0)
            for candidates in candidates_by_vehicle.values()
            for candidate in candidates
        )
        if not has_real_candidate:
            break

        actions = agent.act_pickup_assignments(
            environment,
            snapshot=environment.get_snapshot(),
            candidates_by_v=candidates_by_vehicle,
        )
        if not actions:
            break

        acted = False
        for action in actions:
            request = action.get('request')
            if request is not None and request not in environment.active_request_list:
                continue
            pickup_candidate_request_ids = [
                candidate_request.id
                for candidate in candidates_by_vehicle.get(action['vehicle_idx'], [])
                for candidate_request in [candidate.get('r')]
                if (
                    candidate.get('action_type') == ActionType.PICKUP
                    and candidate_request is not None
                )
            ]
            environment.step(action)
            environment.record_dispatch_decision(
                action,
                decision_round,
                pickup_candidate_request_ids,
            )
            acted = True

        if not acted:
            break
        decision_round += 1
