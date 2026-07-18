import os
import threading

from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO, emit

import app.config as cfg
from app.agent import DQNAgent
from app.env_builder import EnvBuilder
from app.inference_runtime import (
    dispatch_idle_vehicles as dispatch_idle_vehicles_with_agent,
    resolve_model_path as find_model_path,
)
from app.state_builder import append_history_sample, build_state, sim_config_payload
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
sim_thread = None
sim_stop_event = None

utilization_history = []
passenger_history = []


# --------------- Model / Scenario Helpers ---------------

def normalize_scenario(value):
    scenario = str(value or selected_scenario or 'S1').upper()
    if scenario not in AVAILABLE_SCENARIOS:
        return selected_scenario if selected_scenario in AVAILABLE_SCENARIOS else 'S1'
    return scenario


def active_model_path():
    return agent_model_path or resolve_model_path()


def scenario_config():
    model_path = active_model_path()
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


def resolve_model_path():
    return find_model_path(DATA_PATH, RESULT_PATH, MODEL_FILENAME)


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
    model_path = active_model_path()
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


def dashboard_state(metrics=None):
    state = build_state(
        env,
        utilization_history=utilization_history,
        passenger_history=passenger_history,
        config=scenario_config(),
        metrics=metrics,
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
    dispatch_idle_vehicles_with_agent(env, agent or ensure_agent())


def simulation_loop(stop_event):
    global sim_running, sim_stop_event, env

    try:
        while not stop_event.is_set() and env is not None:
            with env_lock:
                if stop_event.is_set():
                    break
                dispatch_idle_vehicles()
                if stop_event.is_set():
                    break

                env.curr_time += 1
                env.handle_time_update()

                metrics = None
                if env.curr_time % 2 == 0:
                    metrics = append_history_sample(
                        env,
                        utilization_history,
                        passenger_history,
                    )

                state = dashboard_state(metrics=metrics)
                done = env.is_done()
                if done:
                    sim_running = False

            socketio.emit('state', state)
            if done:
                socketio.emit('sim_done', {})
                break

            # Do not pace simulation time against wall-clock time. Yield only so
            # Socket.IO can deliver the emitted state before the next calculation.
            socketio.sleep(0)
    except Exception:
        flask_app.logger.exception('Simulation loop failed.')
        socketio.emit('sim_error', {'message': 'Simulation loop failed.'})
    finally:
        if sim_stop_event is stop_event:
            sim_running = False


def stop_simulation_thread():
    global sim_running, sim_thread, sim_stop_event
    sim_running = False
    thread = sim_thread
    stop_event = sim_stop_event
    if stop_event is not None:
        stop_event.set()
    if thread and thread.is_alive() and thread is not threading.current_thread():
        thread.join(timeout=2)
    if thread is None or not thread.is_alive():
        if sim_thread is thread:
            sim_thread = None
            sim_stop_event = None


@socketio.on('connect')
def handle_connect():
    global env
    with env_lock:
        if env is None:
            reset_simulation(selected_scenario)
        emit('sim_meta', meta_payload())
        emit('state', dashboard_state())


@socketio.on('command')
def handle_command(data):
    global sim_running, scenario_locked, sim_thread, sim_stop_event, env

    if not isinstance(data, dict):
        emit('command_error', {'message': 'Command payload must be an object.'})
        return

    cmd = data.get('type')
    payload = data.get('payload')

    if cmd == 'start':
        scenario = normalize_scenario(payload)
        if not sim_running:
            stop_simulation_thread()
            with env_lock:
                if env is None or env.is_done() or scenario != selected_scenario:
                    reset_simulation(scenario)
                    emit('sim_meta', meta_payload())
                else:
                    ensure_agent()
                emit('state', dashboard_state())
                sim_running = True
                scenario_locked = True
                sim_stop_event = threading.Event()
            sim_thread = threading.Thread(
                target=simulation_loop,
                args=(sim_stop_event,),
                daemon=True,
            )
            sim_thread.start()

    elif cmd == 'stop':
        stop_simulation_thread()

    elif cmd == 'reset':
        reset_scenario = selected_scenario if scenario_locked else payload
        stop_simulation_thread()
        with env_lock:
            reset_simulation(reset_scenario)
            scenario_locked = False
            emit('sim_meta', meta_payload())
            emit('state', dashboard_state())

    elif cmd == 'setScenario':
        if scenario_locked:
            with env_lock:
                emit('sim_meta', meta_payload())
                emit('state', dashboard_state())
            return
        stop_simulation_thread()
        with env_lock:
            reset_simulation(payload)
            emit('sim_meta', meta_payload())
            emit('state', dashboard_state())

    else:
        emit('command_error', {'message': f'Unsupported command: {cmd!r}.'})

@flask_app.route('/health')
def health():
    return {'status': 'ok'}


if __name__ == '__main__':
    os.makedirs(RESULT_PATH, exist_ok=True)
    os.makedirs(GENERATED_SCENARIO_PATH, exist_ok=True)
    reset_simulation(selected_scenario)
    socketio.run(flask_app, host='0.0.0.0', port=5001, debug=False, allow_unsafe_werkzeug=True)
