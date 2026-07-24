import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.network_data import (
    load_link_travel_times,
    load_od_travel_times,
    validate_od_against_links,
)
from scripts.gen_scenario_csv import generate_scenario_rows


DATA_DIR = Path(__file__).resolve().parents[1] / 'data'


class NetworkDataTest(unittest.TestCase):
    def test_json_od_matches_link_shortest_paths(self):
        od_travel_times = load_od_travel_times(
            DATA_DIR / 'od_travel_time_dict.json'
        )
        links = load_link_travel_times(DATA_DIR / 'link_list.json')

        validate_od_against_links(od_travel_times, links)

        self.assertEqual(od_travel_times[15][22], 3)
        self.assertEqual(od_travel_times[22][15], 4)
        self.assertEqual(len(od_travel_times), 24)
        self.assertEqual(len(links), 76)

    def test_od_link_mismatch_is_rejected(self):
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            od_path = temp_path / 'od.json'
            link_path = temp_path / 'links.json'
            od_path.write_text(json.dumps({
                '1': {'1': 0, '2': 2},
                '2': {'1': 2, '2': 0},
            }))
            link_path.write_text(json.dumps([
                {'from': 1, 'to': 2, 'weight': 3},
                {'from': 2, 'to': 1, 'weight': 2},
            ]))

            od_travel_times = load_od_travel_times(od_path)
            links = load_link_travel_times(link_path)
            with self.assertRaisesRegex(
                ValueError,
                'OD duration does not match link shortest path',
            ):
                validate_od_against_links(od_travel_times, links)

    def test_generated_requests_use_valid_json_od_pairs(self):
        od_travel_times = load_od_travel_times(
            DATA_DIR / 'od_travel_time_dict.json'
        )
        rows = generate_scenario_rows(
            scenario='S1',
            seed=0,
            n_req=80,
            t_horizon=60,
            od_dict=od_travel_times,
        )

        self.assertEqual(len(rows), 80)
        self.assertTrue(all(
            row['Start_node'] != row['End_node']
            and od_travel_times[row['Start_node']][row['End_node']] > 0
            for row in rows
        ))


if __name__ == '__main__':
    unittest.main()
