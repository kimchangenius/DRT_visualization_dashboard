import os
import threading
import time

from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO, emit

import app.config as cfg
from app.env_builder import EnvBuilder
from app.agent import DQNAgent
from app.state_builder import build_state, append_history_sample, sim_config_payload

CURR_PATH = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(CURR_PATH, 'data')
RESULT_PATH = os.path.join(CURR_PATH, 'result')
MODEL_PATH = os.path.join(DATA_PATH, 'hd256_bs32_lr1e-05.h5')

flask_app = Flask(__name__)
CORS(flask_app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(flask_app, cors_allowed_origins="*", async_mode="threading")

env_builder = EnvBuilder(data_dir=DATA_PATH, result_dir=RESULT_PATH)
agent = DQNAgent(hidden_dim=cfg.HIDDEN_DIM)
agent.load_model(MODEL_PATH)

env = None
env_lock = threading.Lock()
sim_running = False
sim_speed = 1
sim_thread = None

utilization_history = []
passenger_history = []


# --------------- Simulation Loop ---------------

def reset_simulation():
    global env, utilization_history, passenger_history
    env = env_builder.build()
    env.reset()
    utilization_history.clear()
    passenger_history.clear()


def simulation_loop():
    global sim_running, env

    while sim_running and env is not None:
        with env_lock:
            if env.is_done():
                sim_running = False
                socketio.emit('state', build_state(env, utilization_history, passenger_history))
                socketio.emit('sim_done', {})
                break

            while env.has_idle_vehicle():
                action_mask = env.get_action_mask()
                action = agent.act(env.state, action_mask)
                env.enrich_action(action)
                env.step(action)

            env.curr_time += 1
            env.handle_time_update()
            env.sync_state()

            if env.curr_time % 2 == 0:
                append_history_sample(env, utilization_history, passenger_history)

            state = build_state(env, utilization_history, passenger_history)

        socketio.emit('state', state)
        interval = max(0.05, 0.5 / sim_speed)
        time.sleep(interval)


@socketio.on('connect')
def handle_connect():
    global env
    emit('sim_meta', sim_config_payload())
    if env is None:
        reset_simulation()
    with env_lock:
        emit('state', build_state(env, utilization_history, passenger_history))


@socketio.on('command')
def handle_command(data):
    global sim_running, sim_speed, sim_thread, env

    cmd = data.get('type')
    payload = data.get('payload')

    if cmd == 'start':
        if not sim_running:
            if env is None or env.is_done():
                reset_simulation()
            sim_running = True
            sim_thread = threading.Thread(target=simulation_loop, daemon=True)
            sim_thread.start()

    elif cmd == 'stop':
        sim_running = False

    elif cmd == 'reset':
        sim_running = False
        if sim_thread and sim_thread.is_alive():
            sim_thread.join(timeout=2)
        reset_simulation()
        with env_lock:
            emit('state', build_state(env, utilization_history, passenger_history))

    elif cmd == 'setSpeed':
        sim_speed = payload if payload else 1


@flask_app.route('/health')
def health():
    return {'status': 'ok'}


if __name__ == '__main__':
    os.makedirs(RESULT_PATH, exist_ok=True)
    reset_simulation()
    socketio.run(flask_app, host='0.0.0.0', port=5001, debug=False, allow_unsafe_werkzeug=True)
