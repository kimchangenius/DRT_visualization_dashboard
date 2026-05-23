import glob
import os
import threading
import time

from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO, emit

import app.config as cfg
from app.agent import DQNAgent
from app.env_builder import EnvBuilder
from app.state_builder import append_history_sample, build_state, sim_config_payload
from app.vehicle_status import VehicleStatus
from scripts.gen_scenario_csv import generate_scenario_csv

CURR_PATH = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(CURR_PATH, 'data')
RESULT_PATH = os.path.join(CURR_PATH, 'result')
GENERATED_SCENARIO_PATH = os.path.join(DATA_PATH, 'generated_scenarios')

MODEL_CONFIG = dict(cfg.DEFAULT_MODEL_CONFIG)
MODEL_FILENAME = (
    f"hd{MODEL_CONFIG['hidden_dim']}_"
    f"bs{MODEL_CONFIG['batch_size']}_"
    f"lr{MODEL_CONFIG['learning_rate']}.h5"
)

AVAILABLE_SCENARIOS = ('S1', 'S2', 'S3', 'S4')
DEFAULT_SCENARIO = os.environ.get('DRT_SCENARIO', 'S1').upper()
SCENARIO_SEED = int(os.environ.get('DRT_SCENARIO_SEED', '0'))
DEFAULT_SCENARIO_PARAMS = dict(cfg.scenario_config_list[0]) if cfg.scenario_config_list else {}
SCENARIO_N_REQ = int(os.environ.get('DRT_SCENARIO_N_REQ', DEFAULT_SCENARIO_PARAMS.get('n_req', 320)))
SCENARIO_HORIZON = int(os.environ.get('DRT_SCENARIO_HORIZON', DEFAULT_SCENARIO_PARAMS.get('horizon', 240)))
SCENARIO_LAMBDA_BASE = float(os.environ.get('DRT_SCENARIO_LAMBDA_BASE', DEFAULT_SCENARIO_PARAMS.get('lambda_base', 1.0)))
SCENARIO_LAMBDA_HIGH = float(os.environ.get('DRT_SCENARIO_LAMBDA_HIGH', DEFAULT_SCENARIO_PARAMS.get('lambda_high', 6.0)))
SCENARIO_POP_P = float(os.environ.get('DRT_SCENARIO_POP_P', DEFAULT_SCENARIO_PARAMS.get('pop_p', 0.75)))
SIM_TICK_SECONDS = float(os.environ.get('DRT_SIM_TICK_SECONDS', '1.0'))

flask_app = Flask(__name__)
CORS(flask_app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(flask_app, cors_allowed_origins="*", async_mode="threading")

env_builder = None
agent = None
agent_model_path = None
agent_model_mtime = None
env = None
selected_scenario = DEFAULT_SCENARIO if DEFAULT_SCENARIO in AVAILABLE_SCENARIOS else 'S1'
env_lock = threading.Lock()
sim_running = False
scenario_locked = False
sim_speed = 1
sim_thread = None

utilization_history = []
passenger_history = []


# --------------- Model / Scenario Helpers ---------------

def normalize_scenario(value):
    scenario = str(value or selected_scenario or 'S1').upper()
    if scenario not in AVAILABLE_SCENARIOS:
        return selected_scenario if selected_scenario in AVAILABLE_SCENARIOS else 'S1'
    return scenario


def scenario_config():
    model_path = resolve_model_path()
    return {
        **MODEL_CONFIG,
        'scenario': selected_scenario,
        'scenario_seed': SCENARIO_SEED,
        'n_req': SCENARIO_N_REQ,
        'horizon': SCENARIO_HORIZON,
        'model_weight_file': os.path.basename(model_path) if model_path else None,
    }


def ensure_scenario_request_file(scenario):
    request_path = generate_scenario_csv(
        data_dir=DATA_PATH,
        scenario=scenario,
        seed=SCENARIO_SEED,
        n_req=SCENARIO_N_REQ,
        t_horizon=SCENARIO_HORIZON,
        lambda_base=SCENARIO_LAMBDA_BASE,
        lambda_high=SCENARIO_LAMBDA_HIGH,
        pop_p=SCENARIO_POP_P,
        out_dir=GENERATED_SCENARIO_PATH,
    )
    return os.path.relpath(request_path, DATA_PATH)


def make_env_builder(scenario):
    request_filename = ensure_scenario_request_file(scenario)
    return EnvBuilder(
        data_dir=DATA_PATH,
        result_dir=RESULT_PATH,
        request_filename=request_filename,
    )


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


def resolved_model_mtime(path):
    return os.path.getmtime(path) if path and os.path.exists(path) else None


def ensure_agent():
    global agent, agent_model_path, agent_model_mtime
    if env is None:
        raise RuntimeError('Simulation environment must be initialized before the agent.')

    model_path = resolve_model_path()
    model_mtime = resolved_model_mtime(model_path)
    if agent is not None and agent_model_path == model_path and agent_model_mtime == model_mtime:
        return agent

    agent = DQNAgent(
        hidden_dim=MODEL_CONFIG['hidden_dim'],
        edge_weight_np=env.network.edge_weight,
    )

    try:
        agent.load_model(model_path)
    except Exception as exc:
        print(f"Model weights at {model_path} could not be loaded; using initialized weights. {exc}")

    agent_model_path = model_path
    agent_model_mtime = model_mtime
    return agent


def max_request_count():
    if env is None:
        return 0
    return len(getattr(env, 'original_request_list', []) or [])


def scenario_payload():
    model_path = resolve_model_path()
    return {
        'selectedScenario': selected_scenario,
        'availableScenarios': list(AVAILABLE_SCENARIOS),
        'scenarioSeed': SCENARIO_SEED,
        'modelWeightFile': os.path.basename(model_path) if model_path else None,
    }


def meta_payload():
    return {
        **sim_config_payload(scenario_config(), max_num_request=max_request_count()),
        **scenario_payload(),
    }


def dashboard_state():
    state = build_state(
        env,
        utilization_history=utilization_history,
        passenger_history=passenger_history,
        config=scenario_config(),
    )
    state.update(scenario_payload())
    return state

# --------------- Simulation Loop ---------------

def reset_simulation(scenario=None):
    global env, env_builder, selected_scenario, utilization_history, passenger_history
    selected_scenario = normalize_scenario(scenario)
    env_builder = make_env_builder(selected_scenario)
    env = env_builder.build()
    env.reset()
    ensure_agent()
    utilization_history.clear()
    passenger_history.clear()


def dispatch_idle_vehicles():
    current_agent = ensure_agent()

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
        actions = current_agent.act_pickup_assignments(
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


def simulation_loop():
    global sim_running, env

    while sim_running and env is not None:
        with env_lock:
            dispatch_idle_vehicles()

            env.curr_time += 1
            env.handle_time_update()

            if env.curr_time % 2 == 0:
                append_history_sample(env, utilization_history, passenger_history)

            state = dashboard_state()
            done = env.is_done()
            if done:
                sim_running = False

        socketio.emit('state', state)
        if done:
            socketio.emit('sim_done', {})
            break

        speed = sim_speed if isinstance(sim_speed, (int, float)) and sim_speed > 0 else 1
        interval = max(0.05, SIM_TICK_SECONDS / speed)
        time.sleep(interval)


def stop_simulation_thread():
    global sim_running
    sim_running = False
    if sim_thread and sim_thread.is_alive():
        sim_thread.join(timeout=2)


@socketio.on('connect')
def handle_connect():
    global env
    if env is None:
        reset_simulation(selected_scenario)
    with env_lock:
        emit('sim_meta', meta_payload())
        emit('state', dashboard_state())


@socketio.on('command')
def handle_command(data):
    global sim_running, scenario_locked, sim_speed, sim_thread, env

    cmd = data.get('type')
    payload = data.get('payload')

    if cmd == 'start':
        scenario = normalize_scenario(payload)
        if not sim_running:
            if env is None or env.is_done() or scenario != selected_scenario:
                reset_simulation(scenario)
                emit('sim_meta', meta_payload())
            emit('state', dashboard_state())
            sim_running = True
            scenario_locked = True
            sim_thread = threading.Thread(target=simulation_loop, daemon=True)
            sim_thread.start()

    elif cmd == 'stop':
        sim_running = False

    elif cmd == 'reset':
        reset_scenario = selected_scenario if scenario_locked else payload
        stop_simulation_thread()
        reset_simulation(reset_scenario)
        scenario_locked = False
        with env_lock:
            emit('sim_meta', meta_payload())
            emit('state', dashboard_state())

    elif cmd == 'setScenario':
        if scenario_locked:
            with env_lock:
                emit('sim_meta', meta_payload())
                emit('state', dashboard_state())
            return
        stop_simulation_thread()
        reset_simulation(payload)
        with env_lock:
            emit('sim_meta', meta_payload())
            emit('state', dashboard_state())

    elif cmd == 'setSpeed':
        sim_speed = payload if payload else 1


@flask_app.route('/health')
def health():
    return {'status': 'ok'}


if __name__ == '__main__':
    os.makedirs(RESULT_PATH, exist_ok=True)
    os.makedirs(GENERATED_SCENARIO_PATH, exist_ok=True)
    reset_simulation(selected_scenario)
    socketio.run(flask_app, host='0.0.0.0', port=5001, debug=False, allow_unsafe_werkzeug=True)
