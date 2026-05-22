import argparse
import csv
import glob
import json
import os
from datetime import datetime, timezone

import app.config as cfg
from app.agent import DQNAgent
from app.env_builder import EnvBuilder
from app.request_status import RequestStatus
from app.state_builder import (
    append_history_sample,
    build_state,
    json_default,
    sim_config_payload,
)
from app.vehicle_status import VehicleStatus
from scripts.gen_scenario_csv import generate_scenario_csv

CURR_PATH = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(CURR_PATH, 'data')
RESULT_PATH = os.path.join(CURR_PATH, 'result')
GENERATED_SCENARIO_PATH = os.path.join(DATA_PATH, 'generated_scenarios')
REPLAY_FILENAME = 'simulation_replay.json'
MODEL_CONFIG = dict(cfg.DEFAULT_MODEL_CONFIG)
MODEL_FILENAME = (
    f"hd{MODEL_CONFIG['hidden_dim']}_"
    f"bs{MODEL_CONFIG['batch_size']}_"
    f"lr{MODEL_CONFIG['learning_rate']}.h5"
)
AVAILABLE_SCENARIOS = ('S1', 'S2', 'S3', 'S4')
DEFAULT_SCENARIO_PARAMS = dict(cfg.scenario_config_list[0]) if cfg.scenario_config_list else {}


def normalize_scenario(value):
    scenario = str(value or os.environ.get('DRT_SCENARIO', 'S1')).upper()
    return scenario if scenario in AVAILABLE_SCENARIOS else 'S1'


def _existing_h5_files(directory):
    return [path for path in glob.glob(os.path.join(directory, '*.h5')) if os.path.isfile(path)]


def resolve_model_path():
    env_model_path = os.environ.get('DRT_MODEL_PATH')
    if env_model_path:
        return env_model_path

    exact_candidates = [
        os.path.join(DATA_PATH, MODEL_FILENAME),
        os.path.join(RESULT_PATH, MODEL_FILENAME),
    ]
    for path in exact_candidates:
        if os.path.exists(path):
            return path

    for directory in (DATA_PATH, RESULT_PATH):
        weight_files = _existing_h5_files(directory)
        if weight_files:
            return max(weight_files, key=os.path.getmtime)

    return os.path.join(DATA_PATH, MODEL_FILENAME)


def build_agent(env, model_path):
    agent = DQNAgent(
        hidden_dim=MODEL_CONFIG['hidden_dim'],
        edge_weight_np=env.network.edge_weight,
    )
    try:
        agent.load_model(model_path)
    except Exception as exc:
        print(f"Model weights at {model_path} could not be loaded; using initialized weights. {exc}")
    return agent


def generate_request_filename(scenario, seed, n_req, horizon):
    request_path = generate_scenario_csv(
        data_dir=DATA_PATH,
        scenario=scenario,
        seed=seed,
        n_req=n_req,
        t_horizon=horizon,
        lambda_base=float(os.environ.get('DRT_SCENARIO_LAMBDA_BASE', DEFAULT_SCENARIO_PARAMS.get('lambda_base', 1.0))),
        lambda_high=float(os.environ.get('DRT_SCENARIO_LAMBDA_HIGH', DEFAULT_SCENARIO_PARAMS.get('lambda_high', 6.0))),
        pop_p=float(os.environ.get('DRT_SCENARIO_POP_P', DEFAULT_SCENARIO_PARAMS.get('pop_p', 0.75))),
        out_dir=GENERATED_SCENARIO_PATH,
    )
    return os.path.relpath(request_path, DATA_PATH)


def dispatch_idle_vehicles(env, agent):
    while env.has_idle_vehicle():
        idle_vehicles = [v for v in env.vehicle_list if v.status == VehicleStatus.IDLE]
        if not idle_vehicles:
            break

        candidates_by_v = env.enumerate_pair_candidates(idle_vehicles, include_wait=True)
        has_real_candidate = any(
            c.get('is_real', 0)
            for candidates in candidates_by_v.values()
            for c in candidates
        )
        if not has_real_candidate:
            break

        snapshot = env.get_snapshot()
        actions = agent.act_pickup_assignments(
            env,
            snapshot=snapshot,
            candidates_by_v=candidates_by_v,
        )
        if not actions:
            break

        acted = False
        for action in actions:
            request = action.get('request')
            if request is not None and request not in env.active_request_list:
                continue
            env.step(action)
            acted = True

        if not acted:
            break



def run_inference(env_builder, scenario, seed, model_path=None, result_dir=None):
    if result_dir is None:
        result_dir = os.path.join(RESULT_PATH, 'inference')
    os.makedirs(result_dir, exist_ok=True)

    env = env_builder.build()
    env.reset()
    agent = build_agent(env, model_path or resolve_model_path())

    run_config = {
        **MODEL_CONFIG,
        'scenario': scenario,
        'scenario_seed': seed,
    }
    utilization_history = []
    passenger_history = []
    frames = [build_state(env, utilization_history, passenger_history, config=run_config)]

    while True:
        dispatch_idle_vehicles(env, agent)

        env.curr_time += 1
        env.handle_time_update()

        if env.curr_time % 2 == 0:
            append_history_sample(env, utilization_history, passenger_history)

        frames.append(build_state(env, utilization_history, passenger_history, config=run_config))
        if env.is_done():
            break

    total_num_accept = 0
    total_num_serve = 0
    veh_rows = []
    for v in env.vehicle_list:
        total_num_accept += v.num_accept
        total_num_serve += v.num_serve
        v.on_service_driving_time = env.curr_time - v.idle_time
        veh_rows.append([v.id, v.num_accept, v.num_serve, v.on_service_driving_time, v.idle_time])

    total_waiting_time = 0
    total_in_vehicle_time = 0
    served_count = 0
    req_rows = []
    for r in env.done_request_list:
        if r.status == RequestStatus.SERVED:
            r.detour_time = r.in_vehicle_time - r.travel_time
            served_count += 1
            total_waiting_time += r.waiting_time
            total_in_vehicle_time += r.in_vehicle_time
        else:
            r.detour_time = 0
        req_rows.append([r.id, str(r.status), r.waiting_time, r.in_vehicle_time, r.detour_time])
    req_rows.sort(key=lambda x: x[0])

    mean_wt = total_waiting_time / served_count if served_count else 0
    mean_ivt = total_in_vehicle_time / served_count if served_count else 0

    with open(os.path.join(result_dir, 'vehicle.csv'), 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Vehicle ID', 'Num. Accept', 'Num. Serve', 'On-Service Driving Time', 'Idle Time'])
        writer.writerows(veh_rows)

    with open(os.path.join(result_dir, 'request.csv'), 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Request ID', 'Status', 'Waiting Time', 'In-Vehicle Time', 'Detour Time'])
        writer.writerows(req_rows)

    replay_path = os.path.join(result_dir, REPLAY_FILENAME)
    with open(replay_path, 'w', encoding='utf-8') as f:
        json.dump({
            'version': 1,
            'generatedAt': datetime.now(timezone.utc).isoformat(),
            'runName': os.path.basename(result_dir),
            'config': sim_config_payload(
                run_config,
                max_num_request=len(getattr(env, 'original_request_list', []) or []),
            ),
            'frames': frames,
        }, f, ensure_ascii=False, default=json_default)

    print(f"Scenario: {scenario} seed={seed} | Weight: {os.path.basename(resolve_model_path())}")
    print(f"Accepted: {total_num_accept} | Served: {served_count} | "
          f"Avg Wait: {mean_wt:.2f} | Avg In-Vehicle: {mean_ivt:.2f}")
    print(f"Replay JSON: {replay_path}")


def parse_args():
    parser = argparse.ArgumentParser(description='Run dashboard-compatible DRT inference.')
    parser.add_argument('--scenario', choices=AVAILABLE_SCENARIOS, default=os.environ.get('DRT_SCENARIO', 'S1').upper())
    parser.add_argument('--seed', type=int, default=int(os.environ.get('DRT_SCENARIO_SEED', '0')))
    parser.add_argument('--n-req', type=int, default=int(os.environ.get('DRT_SCENARIO_N_REQ', DEFAULT_SCENARIO_PARAMS.get('n_req', 320))))
    parser.add_argument('--horizon', type=int, default=int(os.environ.get('DRT_SCENARIO_HORIZON', DEFAULT_SCENARIO_PARAMS.get('horizon', 240))))
    parser.add_argument('--model-path', default=None)
    return parser.parse_args()


def main():
    args = parse_args()
    scenario = normalize_scenario(args.scenario)
    request_filename = generate_request_filename(scenario, args.seed, args.n_req, args.horizon)
    env_builder = EnvBuilder(data_dir=DATA_PATH, result_dir=RESULT_PATH, request_filename=request_filename)
    run_inference(env_builder, scenario=scenario, seed=args.seed, model_path=args.model_path)


if __name__ == "__main__":
    main()
