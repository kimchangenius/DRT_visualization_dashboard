import os
import threading
import time
from collections import defaultdict

from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO, emit

import app.config as cfg
from app.env_builder import EnvBuilder
from app.agent import DQNAgent
from app.vehicle_status import VehicleStatus
from app.request_status import RequestStatus

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


# --------------- State Extraction ---------------

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


def extract_vehicle(v, environment):
    status_str = STATUS_MAP_VEH.get(v.status, 'idle')

    path = []
    path_progress = 0
    if v.status in (VehicleStatus.PICKUP, VehicleStatus.DROPOFF) and v.next_node > 0:
        path = [v.curr_node, v.next_node]
        total_dur = environment.network.get_duration(v.curr_node, v.next_node)
        if total_dur > 0 and v.target_arrival_time > 0:
            remaining = v.target_arrival_time - environment.curr_time
            progress = 1.0 - (remaining / total_dur)
            path_progress = max(0, min(1, progress))

    return {
        'id': v.id + 1,
        'currentNodeId': v.curr_node,
        'targetNodeId': v.next_node if v.next_node > 0 else None,
        'path': path,
        'pathProgress': round(path_progress, 2),
        'status': status_str,
        'passengerId': v.target_request.id if v.target_request else None,
        'totalTrips': v.num_serve,
        'totalDistance': 0,
    }


def extract_passenger(r):
    return {
        'id': r.id,
        'originNodeId': r.from_node_id,
        'destinationNodeId': r.to_node_id,
        'requestTime': r.request_time,
        'pickupTime': r.pickup_at,
        'deliveryTime': r.dropoff_at,
        'status': STATUS_MAP_REQ.get(r.status, 'waiting'),
        'assignedVehicleId': (r.assigned_v_id + 1) if r.assigned_v_id >= 0 else None,
    }


def compute_metrics(environment):
    served = [r for r in environment.done_request_list if r.status == RequestStatus.SERVED]
    waiting = [r for r in environment.active_request_list
               if r.status in (RequestStatus.PENDING, RequestStatus.ACCEPTED)]
    in_transit = [r for r in environment.active_request_list
                  if r.status == RequestStatus.PICKEDUP]
    busy = [v for v in environment.vehicle_list if v.status not in (VehicleStatus.IDLE, VehicleStatus.REJECT)]

    avg_wait = 0.0
    if served:
        avg_wait = sum(r.waiting_time for r in served) / len(served)

    avg_travel = 0.0
    if served:
        avg_travel = sum(r.in_vehicle_time for r in served if r.in_vehicle_time > 0) / max(len(served), 1)

    util = round(len(busy) / len(environment.vehicle_list) * 100) if environment.vehicle_list else 0
    cancelled = sum(1 for r in environment.done_request_list if r.status == RequestStatus.CANCELLED)

    return {
        'currentTime': environment.curr_time,
        'totalPassengersServed': len(served),
        'totalPassengersWaiting': len(waiting),
        'totalPassengersInTransit': len(in_transit),
        'averageWaitTime': round(avg_wait, 1),
        'averageTravelTime': round(avg_travel, 1),
        'vehicleUtilization': util,
        'cancelCount': cancelled,
        'activeVehicles': len(busy),
        'totalVehicles': len(environment.vehicle_list),
    }


def compute_wait_time_distribution(environment):
    buckets = {'0-2': 0, '3-5': 0, '6-10': 0, '10+': 0}
    for r in environment.done_request_list:
        if r.status == RequestStatus.SERVED and r.waiting_time is not None:
            wt = r.waiting_time
            if wt <= 2:
                buckets['0-2'] += 1
            elif wt <= 5:
                buckets['3-5'] += 1
            elif wt <= 10:
                buckets['6-10'] += 1
            else:
                buckets['10+'] += 1
    return [{'range': k, 'count': v} for k, v in buckets.items()]


def compute_request_status(environment):
    served = sum(1 for r in environment.done_request_list if r.status == RequestStatus.SERVED)
    in_transit = sum(1 for r in environment.active_request_list if r.status == RequestStatus.PICKEDUP)
    waiting = sum(1 for r in environment.active_request_list
                  if r.status in (RequestStatus.PENDING, RequestStatus.ACCEPTED))
    cancelled = sum(1 for r in environment.done_request_list if r.status == RequestStatus.CANCELLED)
    return [
        {'name': 'Served', 'value': served, 'color': '#10b981'},
        {'name': 'In vehicle', 'value': in_transit, 'color': '#3b82f6'},
        {'name': 'Waiting', 'value': waiting, 'color': '#f59e0b'},
        {'name': 'Cancelled', 'value': cancelled, 'color': '#ef4444'},
    ]


def compute_link_loads(environment):
    loads = defaultdict(int)
    for v in environment.vehicle_list:
        if v.status in (VehicleStatus.PICKUP, VehicleStatus.DROPOFF) and v.next_node > 0:
            loads[f'{v.curr_node}-{v.next_node}'] += 1
    return dict(loads)


def build_state(environment):
    metrics = compute_metrics(environment)

    active_passengers = [
        extract_passenger(r) for r in environment.active_request_list
        if r.status in (RequestStatus.PENDING, RequestStatus.ACCEPTED, RequestStatus.PICKEDUP)
    ]
    served_passengers = [
        extract_passenger(r) for r in environment.done_request_list
        if r.status == RequestStatus.SERVED
    ]
    visible_passengers = active_passengers + served_passengers

    return {
        'metrics': metrics,
        'maxNumVehicles': cfg.MAX_NUM_VEHICLES,
        'vehCapacity': cfg.VEH_CAPACITY,
        'maxNumRequest': cfg.MAX_NUM_REQUEST,
        'maxWaitTime': cfg.MAX_WAIT_TIME,
        'hiddenDim': cfg.HIDDEN_DIM,
        'batchSize': cfg.BATCH_SIZE,
        'learningRate': cfg.LEARNING_RATE,
        'vehicles': [extract_vehicle(v, environment) for v in environment.vehicle_list],
        'passengers': visible_passengers,
        'waitTimeDistribution': compute_wait_time_distribution(environment),
        'utilizationHistory': list(utilization_history),
        'passengerHistory': list(passenger_history),
        'requestStatusData': compute_request_status(environment),
        'linkLoads': compute_link_loads(environment),
    }


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
                socketio.emit('state', build_state(env))
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
                m = compute_metrics(env)
                utilization_history.append({
                    'time': env.curr_time,
                    'utilization': m['vehicleUtilization']
                })
                if len(utilization_history) > 200:
                    utilization_history.pop(0)
                passenger_history.append({
                    'time': env.curr_time,
                    'served': m['totalPassengersServed'],
                    'waiting': m['totalPassengersWaiting'],
                    'cancelled': m['cancelCount'],
                })
                if len(passenger_history) > 200:
                    passenger_history.pop(0)

            state = build_state(env)

        socketio.emit('state', state)
        interval = max(0.05, 0.5 / sim_speed)
        time.sleep(interval)


# --------------- SocketIO Events ---------------

def sim_config_payload():
    return {
        'maxNumVehicles': cfg.MAX_NUM_VEHICLES,
        'vehCapacity': cfg.VEH_CAPACITY,
        'maxNumRequest': cfg.MAX_NUM_REQUEST,
        'maxWaitTime': cfg.MAX_WAIT_TIME,
        'hiddenDim': cfg.HIDDEN_DIM,
        'batchSize': cfg.BATCH_SIZE,
        'learningRate': cfg.LEARNING_RATE,
    }


@socketio.on('connect')
def handle_connect():
    global env
    emit('sim_meta', sim_config_payload())
    if env is None:
        reset_simulation()
    with env_lock:
        emit('state', build_state(env))


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
            emit('state', build_state(env))

    elif cmd == 'setSpeed':
        sim_speed = payload if payload else 1


@flask_app.route('/health')
def health():
    return {'status': 'ok'}


if __name__ == '__main__':
    os.makedirs(RESULT_PATH, exist_ok=True)
    reset_simulation()
    socketio.run(flask_app, host='0.0.0.0', port=5001, debug=False, allow_unsafe_werkzeug=True)
