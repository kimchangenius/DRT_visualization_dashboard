from pathlib import Path
from types import SimpleNamespace
import unittest

from app.action_type import ActionType
from app.env import RideSharingEnvironment
from app.inference_runtime import dispatch_idle_vehicles
from app.network import DRTNetwork
from app.request import Request
from app.request_status import RequestStatus
from app.state_builder import (
    build_simulation_replay_payload,
    compute_metrics,
    encode_passenger_events,
    encode_recent_vehicle_movements,
    encode_vehicle_movements,
    extract_vehicle,
)
from app.vehicle_status import VehicleStatus


DATA_DIR = Path(__file__).resolve().parents[1] / 'data'


class FractionalRouteNetwork:
    max_duration = 2

    @staticmethod
    def get_duration(_from_node, _to_node):
        return 1.5

    @staticmethod
    def get_shortest_route(from_node, to_node):
        return [from_node] if from_node == to_node else [from_node, to_node]

    @staticmethod
    def get_route_edges(route_node_ids):
        if len(route_node_ids) < 2:
            return []
        return [{
            'from': route_node_ids[0],
            'to': route_node_ids[1],
            'travel_time': 1.5,
            'distance': 6.0,
        }]


def build_network():
    network = DRTNetwork()
    network.set_edge_data(
        DATA_DIR / 'link_list.json',
        DATA_DIR / 'edge_distance.csv',
    )
    network.set_od_matrix(DATA_DIR / 'od_travel_time_dict.json')
    return network


def passenger_snapshot(
    request_id,
    *,
    assigned_vehicle_id,
    pickup_time=None,
    delivery_time=None,
    passenger_count=1,
):
    return {
        'id': request_id,
        'originNodeId': 2,
        'destinationNodeId': 7,
        'numPassengers': passenger_count,
        'pickupTime': pickup_time,
        'deliveryTime': delivery_time,
        'assignedVehicleId': assigned_vehicle_id,
    }


def replay_frame(time, passengers=None, marker=None):
    return {
        'metrics': {'currentTime': time},
        'vehicles': [],
        'passengers': passengers or [],
        'utilizationHistory': [{'time': time, 'utilization': 50}],
        'passengerHistory': [{'time': time, 'served': 1, 'waiting': 0, 'cancelled': 0}],
        'marker': marker,
    }


def request(status, passenger_count, waiting_time=0, in_vehicle_time=0):
    return SimpleNamespace(
        status=status,
        num_passengers=passenger_count,
        waiting_time=waiting_time,
        in_vehicle_time=in_vehicle_time,
    )


class StateBuilderTest(unittest.TestCase):
    def test_fractional_pickup_duration_finishes_on_next_tick(self):
        network = FractionalRouteNetwork()
        source_request = Request(1, 2, 3, 0, network)
        source_request.set_travel_time(1.5)
        environment = RideSharingEnvironment(
            network,
            [source_request],
            [1, 1, 1, 1],
        )
        environment.reset()
        active_request = environment.active_request_list[0]
        vehicle = environment.vehicle_list[0]
        environment._start_pickup(vehicle, active_request)

        environment.curr_time = 2
        environment.handle_time_update(count_idle=False)

        self.assertEqual(active_request.status, RequestStatus.PICKEDUP)
        self.assertEqual(active_request.pickup_at, 2)
        self.assertEqual(vehicle.num_passengers, 1)
        self.assertEqual(vehicle.total_distance, 6)
        self.assertEqual(vehicle.movement_history[0]['end_reason'], 'arrived')

    def test_request_rejects_non_positive_passenger_count(self):
        network = SimpleNamespace()
        with self.assertRaisesRegex(ValueError, 'positive'):
            Request(1, 1, 2, 0, network, num_passengers=0)

    def test_passenger_events_retain_historical_vehicle_assignment(self):
        frames = [
            replay_frame(0, [passenger_snapshot(11, assigned_vehicle_id=3)]),
            replay_frame(2, [
                passenger_snapshot(
                    11,
                    assigned_vehicle_id=3,
                    pickup_time=2,
                    passenger_count=2,
                ),
            ]),
            replay_frame(5, [
                passenger_snapshot(
                    11,
                    assigned_vehicle_id=None,
                    pickup_time=2,
                    delivery_time=5,
                    passenger_count=2,
                ),
            ]),
        ]

        self.assertEqual(
            encode_passenger_events(frames),
            [
                {
                    'time': 2,
                    'type': 'pickup',
                    'vehicleId': 3,
                    'passengerId': 11,
                    'passengerCount': 2,
                    'nodeId': 2,
                },
                {
                    'time': 5,
                    'type': 'dropoff',
                    'vehicleId': 3,
                    'passengerId': 11,
                    'passengerCount': 2,
                    'nodeId': 7,
                },
            ],
        )

    def test_replay_payload_orders_deduplicates_and_compacts_frames(self):
        environment = SimpleNamespace(original_request_list=[])
        payload = build_simulation_replay_payload(
            environment,
            {
                'frames': [
                    replay_frame(2, marker='late'),
                    replay_frame(0, marker='old'),
                    replay_frame(0, marker='replacement'),
                ],
            },
            generated_at='2026-07-18T00:00:00+00:00',
        )

        self.assertEqual(payload['version'], 4)
        self.assertEqual(payload['distanceUnit'], 'network_distance_unit')
        self.assertEqual(payload['vehicleMovements'], [])
        self.assertEqual(
            [frame['metrics']['currentTime'] for frame in payload['frames']],
            [0, 2],
        )
        self.assertEqual(payload['frames'][0]['marker'], 'replacement')
        self.assertTrue(all(
            frame['dispatchDecisionEvents'] == [] and
            frame['utilizationHistory'] == [] and
            frame['passengerHistory'] == [] and
            frame['requestStatusData'] == []
            for frame in payload['frames']
        ))
        self.assertEqual(payload['passengerEvents'], [])
        self.assertEqual(payload['dispatchDecisions'], [])

    def test_replay_payload_rejects_non_v4_versions(self):
        environment = SimpleNamespace(original_request_list=[])
        for version in (1, 2, 3, 5):
            with self.subTest(version=version):
                with self.assertRaisesRegex(ValueError, 'version'):
                    build_simulation_replay_payload(
                        environment,
                        {'frames': []},
                        version=version,
                    )

    def test_dispatch_runtime_records_executed_actions_by_round(self):
        pending_request = SimpleNamespace(id=17)

        class RecordingEnvironment:
            def __init__(self):
                self.curr_time = 6
                self.dispatch_decisions = []
                self.active_request_list = [pending_request]
                self.vehicle_list = [
                    SimpleNamespace(id=0, status=VehicleStatus.IDLE),
                    SimpleNamespace(id=1, status=VehicleStatus.IDLE),
                ]

            def has_idle_vehicle(self):
                return any(
                    vehicle.status == VehicleStatus.IDLE
                    for vehicle in self.vehicle_list
                )

            def enumerate_pair_candidates(self, _vehicles, include_wait):
                self.assert_include_wait = include_wait
                return {
                    0: [{
                        'is_real': 1,
                        'action_type': ActionType.PICKUP,
                        'r': pending_request,
                    }],
                    1: [{
                        'is_real': 1,
                        'action_type': ActionType.PICKUP,
                        'r': pending_request,
                    }],
                }

            @staticmethod
            def get_snapshot():
                return {}

            def step(self, action):
                vehicle = self.vehicle_list[action['vehicle_idx']]
                vehicle.status = (
                    VehicleStatus.PICKUP
                    if action['action_type'] == ActionType.PICKUP
                    else VehicleStatus.REJECT
                )

            record_dispatch_decision = RideSharingEnvironment.record_dispatch_decision

        class RecordingAgent:
            @staticmethod
            def act_pickup_assignments(_environment, snapshot, candidates_by_v):
                assert snapshot == {}
                assert set(candidates_by_v) == {0, 1}
                return [
                    {
                        'vehicle_idx': 0,
                        'action_type': ActionType.PICKUP,
                        'request': pending_request,
                    },
                    {
                        'vehicle_idx': 1,
                        'action_type': ActionType.REJECT,
                        'request': None,
                    },
                ]

        environment = RecordingEnvironment()
        dispatch_idle_vehicles(environment, RecordingAgent())

        self.assertTrue(environment.assert_include_wait)
        self.assertEqual(
            environment.dispatch_decisions,
            [
                {
                    'time': 6,
                    'decisionRound': 0,
                    'vehicleId': 1,
                    'actionType': 'pickup',
                    'requestId': 17,
                    'pickupCandidateRequestIds': [17],
                },
                {
                    'time': 6,
                    'decisionRound': 0,
                    'vehicleId': 2,
                    'actionType': 'wait',
                    'requestId': None,
                    'pickupCandidateRequestIds': [17],
                },
            ],
        )

    def test_metrics_count_passenger_units_and_weight_averages(self):
        served_a = request(RequestStatus.SERVED, 3, waiting_time=2, in_vehicle_time=4)
        served_b = request(RequestStatus.SERVED, 1, waiting_time=10, in_vehicle_time=8)
        cancelled = request(RequestStatus.CANCELLED, 2)
        waiting = request(RequestStatus.PENDING, 2)
        in_transit = request(RequestStatus.PICKEDUP, 4)
        environment = SimpleNamespace(
            curr_time=12,
            done_request_list=[served_a, served_b, cancelled],
            active_request_list=[waiting, in_transit],
            vehicle_list=[
                SimpleNamespace(status=VehicleStatus.IDLE),
                SimpleNamespace(status=VehicleStatus.PICKUP),
            ],
        )

        metrics = compute_metrics(environment)

        self.assertEqual(metrics['totalPassengersServed'], 4)
        self.assertEqual(metrics['totalPassengersWaiting'], 2)
        self.assertEqual(metrics['totalPassengersInTransit'], 4)
        self.assertEqual(metrics['cancelCount'], 2)
        self.assertEqual(metrics['averageWaitTime'], 4.0)
        self.assertEqual(metrics['averageTravelTime'], 5.0)
        self.assertEqual(metrics['vehicleUtilization'], 50)

    def test_network_route_matches_od_and_accumulates_edge_distance(self):
        network = build_network()
        self.assertEqual(
            network.get_shortest_route(1, 24),
            [1, 3, 12, 13, 24],
        )
        self.assertEqual(network.get_duration(1, 24), 13)
        self.assertEqual(network.get_duration(15, 22), 3)
        self.assertEqual(network.get_route_distance(1, 24), 15)

        source_request = Request(1, 24, 2, 0, network)
        source_request.set_travel_time(network.get_duration(24, 2))
        environment = RideSharingEnvironment(
            network,
            [source_request],
            [1, 1, 1, 1],
        )
        environment.reset()
        vehicle = environment.vehicle_list[0]
        environment._start_pickup(vehicle, environment.active_request_list[0])
        environment.curr_time = 5
        vehicle.update_route_progress(environment.curr_time)

        encoded_vehicle = extract_vehicle(vehicle, environment)
        self.assertEqual(encoded_vehicle['path'], [1, 3, 12, 13, 24])
        self.assertEqual(encoded_vehicle['currentEdgeIndex'], 2)
        self.assertEqual(encoded_vehicle['currentEdgeProgress'], 0)
        self.assertEqual(encoded_vehicle['routeDistanceTravelled'], 8)
        self.assertEqual(encoded_vehicle['totalDistance'], 8)
        live_movements = encode_recent_vehicle_movements(environment)
        self.assertEqual(len(live_movements), 1)
        self.assertEqual(live_movements[0]['endReason'], 'in_progress')
        self.assertEqual(live_movements[0]['travelledDistance'], 8)

    def test_cancelled_route_encodes_partial_edge_distance(self):
        network = build_network()
        source_request = Request(1, 24, 2, 0, network)
        source_request.set_travel_time(network.get_duration(24, 2))
        environment = RideSharingEnvironment(
            network,
            [source_request],
            [1, 1, 1, 1],
        )
        environment.reset()
        active_request = environment.active_request_list[0]
        vehicle = environment.vehicle_list[0]
        environment._start_pickup(vehicle, active_request)
        environment.curr_time = 1
        environment._clear_pickup_assignment(active_request)

        self.assertAlmostEqual(vehicle.total_distance, 4 / 3)
        movements = encode_vehicle_movements(environment)
        self.assertEqual(len(movements), 1)
        self.assertEqual(movements[0]['endReason'], 'cancelled')
        self.assertEqual(movements[0]['routeNodeIds'], [1, 3, 12, 13, 24])
        self.assertEqual(movements[0]['plannedDistance'], 15)
        self.assertAlmostEqual(movements[0]['travelledDistance'], 4 / 3)
        self.assertAlmostEqual(
            movements[0]['edges'][0]['distanceTravelled'],
            4 / 3,
        )
        self.assertTrue(all(
            edge['distanceTravelled'] == 0
            for edge in movements[0]['edges'][1:]
        ))


if __name__ == '__main__':
    unittest.main()
