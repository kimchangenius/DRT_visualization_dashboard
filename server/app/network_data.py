import heapq
import json
import math


def _load_json(path):
    with open(path, encoding='utf-8') as jsonfile:
        return json.load(jsonfile)


def _node_id(value, context):
    try:
        node_id = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f'{context} must be an integer node ID: {value!r}') from exc
    if node_id <= 0:
        raise ValueError(f'{context} must be positive: {node_id}')
    return node_id


def _non_negative_number(value, context):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f'{context} must be numeric: {value!r}') from exc
    if not math.isfinite(number) or number < 0:
        raise ValueError(f'{context} must be finite and non-negative: {number}')
    return number


def load_od_travel_times(path):
    """Load a complete directed OD travel-time matrix from JSON."""
    payload = _load_json(path)
    if not isinstance(payload, dict) or not payload:
        raise ValueError('OD travel-time JSON must be a non-empty object')

    od_travel_times = {}
    for raw_origin, raw_destinations in payload.items():
        origin = _node_id(raw_origin, 'OD origin')
        if origin in od_travel_times:
            raise ValueError(f'Duplicate OD origin after ID normalization: {origin}')
        if not isinstance(raw_destinations, dict):
            raise ValueError(f'OD row {origin} must be an object')

        destinations = {}
        for raw_destination, raw_duration in raw_destinations.items():
            destination = _node_id(
                raw_destination,
                f'OD destination from node {origin}',
            )
            if destination in destinations:
                raise ValueError(
                    'Duplicate OD destination after ID normalization: '
                    f'{origin}->{destination}'
                )
            duration = _non_negative_number(
                raw_duration,
                f'OD duration {origin}->{destination}',
            )
            if origin == destination and duration != 0:
                raise ValueError(
                    f'OD diagonal duration must be zero: {origin}->{destination}'
                )
            if origin != destination and duration <= 0:
                raise ValueError(
                    f'OD duration must be positive: {origin}->{destination}'
                )
            destinations[destination] = duration
        od_travel_times[origin] = destinations

    node_ids = set(od_travel_times)
    for origin, destinations in od_travel_times.items():
        destination_ids = set(destinations)
        if destination_ids != node_ids:
            missing = sorted(node_ids - destination_ids)
            extra = sorted(destination_ids - node_ids)
            raise ValueError(
                f'OD row {origin} is incomplete: missing={missing}, extra={extra}'
            )

    return {
        origin: {
            destination: od_travel_times[origin][destination]
            for destination in sorted(node_ids)
        }
        for origin in sorted(node_ids)
    }


def load_link_travel_times(path):
    """Load directed links from JSON and normalize weight to travel_time."""
    payload = _load_json(path)
    if not isinstance(payload, list) or not payload:
        raise ValueError('Link-list JSON must be a non-empty array')

    links = []
    seen_edges = set()
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            raise ValueError(f'Link at index {index} must be an object')
        try:
            from_node_id = _node_id(item['from'], f'Link {index} from')
            to_node_id = _node_id(item['to'], f'Link {index} to')
            travel_time = _non_negative_number(
                item['weight'],
                f'Link {from_node_id}->{to_node_id} weight',
            )
        except KeyError as exc:
            raise ValueError(
                f'Link at index {index} is missing {exc.args[0]!r}'
            ) from exc

        if from_node_id == to_node_id:
            raise ValueError(f'Link cannot be a self-loop: {from_node_id}')
        if travel_time <= 0:
            raise ValueError(
                f'Link travel time must be positive: {from_node_id}->{to_node_id}'
            )

        edge_key = (from_node_id, to_node_id)
        if edge_key in seen_edges:
            raise ValueError(
                f'Duplicate directed link: {from_node_id}->{to_node_id}'
            )
        seen_edges.add(edge_key)
        links.append({
            'from': from_node_id,
            'to': to_node_id,
            'travel_time': travel_time,
        })

    return links


def validate_od_against_links(od_travel_times, links):
    """Validate every OD duration against directed link shortest paths."""
    od_node_ids = set(od_travel_times)
    link_node_ids = {
        node_id
        for link in links
        for node_id in (link['from'], link['to'])
    }
    if link_node_ids != od_node_ids:
        raise ValueError(
            'Link graph nodes do not match OD nodes: '
            f'links={sorted(link_node_ids)}, od={sorted(od_node_ids)}'
        )

    adjacency = {node_id: [] for node_id in od_node_ids}
    for link in links:
        adjacency[link['from']].append(
            (link['to'], link['travel_time'])
        )

    for origin in sorted(od_node_ids):
        shortest = {origin: 0.0}
        queue = [(0.0, origin)]
        while queue:
            duration, node_id = heapq.heappop(queue)
            if duration != shortest.get(node_id):
                continue
            for to_node_id, travel_time in adjacency[node_id]:
                candidate = duration + travel_time
                if candidate < shortest.get(to_node_id, math.inf):
                    shortest[to_node_id] = candidate
                    heapq.heappush(queue, (candidate, to_node_id))

        unreachable = od_node_ids - set(shortest)
        if unreachable:
            raise ValueError(
                f'Link graph is disconnected from node {origin}: '
                f'{sorted(unreachable)}'
            )
        for destination in sorted(od_node_ids):
            expected = od_travel_times[origin][destination]
            actual = shortest[destination]
            if not math.isclose(actual, expected, abs_tol=1e-9):
                raise ValueError(
                    'OD duration does not match link shortest path: '
                    f'{origin}->{destination}, od={expected}, links={actual}'
                )
