import os
import csv
import json
from datetime import datetime, timezone

import app.config as cfg
from app.env_builder import EnvBuilder
from app.agent import DQNAgent
from app.request_status import RequestStatus
from app.state_builder import build_state, append_history_sample, sim_config_payload

CURR_PATH = os.getcwd()
DATA_PATH = os.path.join(CURR_PATH, 'data')
RESULT_PATH = os.path.join(CURR_PATH, 'result')
MODEL_PATH = os.path.join(DATA_PATH, 'hd256_bs32_lr1e-05.h5')
REPLAY_FILENAME = 'simulation_replay.json'


def run_inference(env_builder, model_path, result_dir=None):
    if result_dir is None:
        result_dir = os.path.join(RESULT_PATH, 'inference')
    os.makedirs(result_dir, exist_ok=True)

    agent = DQNAgent(hidden_dim=cfg.HIDDEN_DIM)
    agent.load_model(model_path)

    env = env_builder.build()
    state = env.reset()
    total_reward = 0
    utilization_history = []
    passenger_history = []
    frames = [build_state(env, utilization_history, passenger_history)]

    while True:
        while env.has_idle_vehicle():
            action_mask = env.get_action_mask()
            action = agent.act(state, action_mask)
            env.enrich_action(action)
            next_state, reward, info = env.step(action)
            total_reward += reward
            state = next_state

        env.curr_time += 1
        env.handle_time_update()

        if env.is_done():
            if env.curr_time % 2 == 0:
                append_history_sample(env, utilization_history, passenger_history)
            frames.append(build_state(env, utilization_history, passenger_history))
            break

        env.sync_state()
        state = env.state

        if env.curr_time % 2 == 0:
            append_history_sample(env, utilization_history, passenger_history)
        frames.append(build_state(env, utilization_history, passenger_history))

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
        r.detour_time = r.in_vehicle_time - r.travel_time
        if r.status == RequestStatus.SERVED:
            served_count += 1
            total_waiting_time += r.waiting_time
            total_in_vehicle_time += r.in_vehicle_time
        req_rows.append([r.id, str(r.status), r.waiting_time, r.in_vehicle_time, r.detour_time])
    req_rows.sort(key=lambda x: x[0])

    mean_wt = total_waiting_time / served_count if served_count else 0
    mean_ivt = total_in_vehicle_time / served_count if served_count else 0

    with open(os.path.join(result_dir, 'vehicle.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Vehicle ID', 'Num. Accept', 'Num. Serve', 'On-Service Driving Time', 'Idle Time'])
        w.writerows(veh_rows)

    with open(os.path.join(result_dir, 'request.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Request ID', 'Status', 'Waiting Time', 'In-Vehicle Time', 'Detour Time'])
        w.writerows(req_rows)

    replay_path = os.path.join(result_dir, REPLAY_FILENAME)
    with open(replay_path, 'w') as f:
        json.dump({
            'version': 1,
            'generatedAt': datetime.now(timezone.utc).isoformat(),
            'runName': os.path.basename(result_dir),
            'config': sim_config_payload(),
            'frames': frames,
        }, f)

    print(f"Reward: {total_reward:.2f} | Served: {served_count} | "
          f"Avg Wait: {mean_wt:.2f} | Avg In-Vehicle: {mean_ivt:.2f}")
    print(f"Replay JSON: {replay_path}")


def main():
    env_builder = EnvBuilder(data_dir=DATA_PATH, result_dir=RESULT_PATH)
    run_inference(env_builder, MODEL_PATH)


if __name__ == "__main__":
    main()
