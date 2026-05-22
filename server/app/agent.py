"""Inference-only pair-wise DQN policy used by the dashboard server."""
import os

import numpy as np
import tensorflow as tf
import app.config as cfg

from scipy.optimize import linear_sum_assignment
from tensorflow.keras.layers import Dense, Embedding

from app.action_type import ActionType
from app.vehicle_status import VehicleStatus


def _configure_gpu_memory_growth():
    gpus = tf.config.list_physical_devices('GPU')
    for gpu in gpus:
        try:
            tf.config.experimental.set_memory_growth(gpu, True)
        except RuntimeError:
            pass


_configure_gpu_memory_growth()


class MLPPairScorer(tf.keras.Model):
    def __init__(self, hidden_dim, edge_weight_np=None, **kwargs):
        super().__init__(**kwargs)
        _ = edge_weight_np
        self.hidden_dim = hidden_dim

        self.node_emb = Embedding(
            cfg.NUM_NODES + 1, cfg.NODE_EMB_DIM, name='node_embedding'
        )
        self.v_proj = Dense(hidden_dim, activation='relu', name='v_proj')
        self.r_proj = Dense(hidden_dim, activation='relu', name='r_proj')
        self.global_proj = tf.keras.Sequential([
            Dense(hidden_dim, activation='relu'),
            Dense(hidden_dim, activation='relu'),
        ], name='global_proj')
        self.r_null = self.add_weight(
            name='r_null_token',
            shape=(hidden_dim,),
            initializer='glorot_uniform',
            trainable=True,
        )
        self.pair_head = tf.keras.Sequential([
            Dense(hidden_dim, activation='relu'),
            Dense(hidden_dim, activation='relu'),
            Dense(1, dtype='float32', name='q_out'),
        ], name='pair_head')

    def call(self, inputs, training=False):
        _ = training
        (
            vehicle_static, vehicle_nodes,
            request_static, request_nodes, request_mask,
            time_norm, global_stats,
            pair_batch_idx, pair_v_idx, pair_r_idx, pair_is_reject, pair_rel,
            pair_agg_batch,
        ) = inputs
        v_ctx, r_ctx, g_ctx = self.encode_context(
            vehicle_static, vehicle_nodes,
            request_static, request_nodes, request_mask,
            time_norm, global_stats,
        )
        return self.score_pairs(
            v_ctx, r_ctx, g_ctx,
            pair_batch_idx, pair_v_idx, pair_r_idx, pair_is_reject, pair_rel,
            pair_agg_batch,
        )

    def encode_context(
        self,
        vehicle_static, vehicle_nodes,
        request_static, request_nodes, request_mask,
        time_norm, global_stats,
    ):
        all_nodes = tf.range(cfg.NUM_NODES + 1)
        node_tbl = self.node_emb(all_nodes)
        fd = node_tbl.dtype

        v_node_emb = tf.gather(node_tbl, vehicle_nodes)
        v_shape = tf.shape(vehicle_static)
        v_node_emb = tf.reshape(
            v_node_emb, (v_shape[0], v_shape[1], 2 * cfg.NODE_EMB_DIM)
        )
        v_input = tf.concat([tf.cast(vehicle_static, fd), v_node_emb], axis=-1)
        v_ctx = self.v_proj(v_input)

        r_node_emb = tf.gather(node_tbl, request_nodes)
        r_shape = tf.shape(request_static)
        r_node_emb = tf.reshape(
            r_node_emb, (r_shape[0], r_shape[1], 2 * cfg.NODE_EMB_DIM)
        )
        r_input = tf.concat([tf.cast(request_static, fd), r_node_emb], axis=-1)
        r_ctx = self.r_proj(r_input)

        v_pool = tf.reduce_mean(v_ctx, axis=1)
        rmask_f = tf.cast(request_mask, r_ctx.dtype)
        r_sum = tf.reduce_sum(r_ctx * tf.expand_dims(rmask_f, -1), axis=1)
        r_cnt = tf.reduce_sum(rmask_f, axis=1, keepdims=True)
        r_pool = r_sum / tf.maximum(r_cnt, 1.0)

        tn = tf.cast(tf.expand_dims(time_norm, -1), fd)
        gs = tf.cast(global_stats, fd)
        global_in = tf.concat([v_pool, r_pool, tn, gs], axis=-1)
        global_ctx = self.global_proj(global_in)
        return v_ctx, r_ctx, global_ctx

    def score_pairs(
        self,
        v_ctx, r_ctx, global_ctx,
        pair_batch_idx, pair_v_idx, pair_r_idx, pair_is_reject, pair_rel,
        pair_agg_batch,
    ):
        v_gather = tf.stack([pair_batch_idx, pair_v_idx], axis=1)
        v_emb = tf.gather_nd(v_ctx, v_gather)

        r_len = tf.shape(r_ctx)[1]
        batch_size = tf.shape(r_ctx)[0]
        hidden_size = tf.shape(r_ctx)[2]
        r_ctx_safe = tf.cond(
            tf.greater(r_len, 0),
            lambda: r_ctx,
            lambda: tf.zeros((batch_size, 1, hidden_size), dtype=r_ctx.dtype),
        )

        r_gather = tf.stack([pair_batch_idx, pair_r_idx], axis=1)
        r_emb_real = tf.gather_nd(r_ctx_safe, r_gather)
        is_reject = tf.cast(pair_is_reject, tf.bool)[:, tf.newaxis]
        r_null = tf.cast(self.r_null, r_emb_real.dtype)
        r_null_batch = tf.broadcast_to(r_null[tf.newaxis, :], tf.shape(r_emb_real))
        r_emb = tf.where(is_reject, r_null_batch, r_emb_real)

        g_emb = tf.gather(global_ctx, pair_batch_idx)
        pair_rel = tf.cast(pair_rel, v_emb.dtype)
        pair_agg = tf.cast(tf.gather(pair_agg_batch, pair_batch_idx), v_emb.dtype)
        pair_in = tf.concat([v_emb, r_emb, pair_rel, g_emb, pair_agg], axis=-1)
        q = self.pair_head(pair_in)
        return tf.squeeze(q, axis=-1)


class DQNAgent:
    def __init__(self, hidden_dim, edge_weight_np=None):
        self.hidden_dim = hidden_dim
        self.model = MLPPairScorer(hidden_dim, edge_weight_np)
        self._dry_forward(self.model)

    @staticmethod
    def _dry_forward(model):
        vehicle_count = cfg.MAX_NUM_VEHICLES
        request_count = 1
        inputs = (
            tf.zeros((1, vehicle_count, cfg.VEHICLE_RAW_DIM), dtype=tf.float32),
            tf.zeros((1, vehicle_count, 2), dtype=tf.int32),
            tf.zeros((1, request_count, cfg.REQUEST_RAW_DIM), dtype=tf.float32),
            tf.zeros((1, request_count, 2), dtype=tf.int32),
            tf.ones((1, request_count), dtype=tf.bool),
            tf.zeros((1,), dtype=tf.float32),
            tf.zeros((1, cfg.GLOBAL_STATS_DIM), dtype=tf.float32),
            tf.zeros((1,), dtype=tf.int32),
            tf.zeros((1,), dtype=tf.int32),
            tf.zeros((1,), dtype=tf.int32),
            tf.ones((1,), dtype=tf.float32),
            tf.zeros((1, cfg.RELATION_INPUT_DIM), dtype=tf.float32),
            tf.zeros((1, cfg.PAIR_AGG_DIM), dtype=tf.float32),
        )
        model(inputs, training=False)

    def load_model(self, file_path):
        if os.path.exists(file_path):
            self.model.load_weights(file_path)
            print(f"Model weights loaded at {file_path}")
        else:
            print(f"No model weights loaded at {file_path}")

    @staticmethod
    def _pair_agg_numpy(snapshot_or_none):
        if snapshot_or_none is None:
            return np.zeros(cfg.PAIR_AGG_DIM, dtype=np.float32)
        pair_agg = snapshot_or_none.get('pair_agg')
        if pair_agg is None:
            return np.zeros(cfg.PAIR_AGG_DIM, dtype=np.float32)
        pair_agg = np.asarray(pair_agg, dtype=np.float32).reshape(-1)
        if pair_agg.shape[0] != cfg.PAIR_AGG_DIM:
            normalized = np.zeros(cfg.PAIR_AGG_DIM, dtype=np.float32)
            n = min(pair_agg.shape[0], cfg.PAIR_AGG_DIM)
            normalized[:n] = pair_agg[:n]
            pair_agg = normalized
        return pair_agg

    @staticmethod
    def _snapshot_to_batched_tensors(snapshot):
        vehicle_static = tf.constant(snapshot['vehicle_static'][None, ...], dtype=tf.float32)
        vehicle_nodes = tf.constant(snapshot['vehicle_nodes'][None, ...], dtype=tf.int32)
        request_count = snapshot['request_static'].shape[0]
        if request_count > 0:
            request_static = tf.constant(snapshot['request_static'][None, ...], dtype=tf.float32)
            request_nodes = tf.constant(snapshot['request_nodes'][None, ...], dtype=tf.int32)
            request_mask = tf.ones((1, request_count), dtype=tf.bool)
        else:
            request_static = tf.zeros((1, 0, cfg.REQUEST_RAW_DIM), dtype=tf.float32)
            request_nodes = tf.zeros((1, 0, 2), dtype=tf.int32)
            request_mask = tf.zeros((1, 0), dtype=tf.bool)
        time_norm = tf.constant([snapshot['time_norm']], dtype=tf.float32)
        global_stats = tf.constant(snapshot['global_stats'][None, ...], dtype=tf.float32)
        pair_agg = tf.constant(
            DQNAgent._pair_agg_numpy(snapshot)[None, ...], dtype=tf.float32
        )
        return (
            vehicle_static, vehicle_nodes,
            request_static, request_nodes, request_mask,
            time_norm, global_stats, pair_agg,
        )

    @staticmethod
    def _has_real_candidate(candidates_by_vehicle):
        return any(
            candidate.get('is_real', 0)
            for candidates in candidates_by_vehicle.values()
            for candidate in candidates
        )

    def act_pickup_assignments(self, env, snapshot=None, candidates_by_v=None):
        idle_vehicles = [
            vehicle for vehicle in env.vehicle_list
            if vehicle.status == VehicleStatus.IDLE
        ]
        if not idle_vehicles:
            return []

        if snapshot is None:
            snapshot = env.get_snapshot()
        if candidates_by_v is None:
            candidates_by_v = env.enumerate_pair_candidates(
                idle_vehicles, include_wait=True
            )
        if not self._has_real_candidate(candidates_by_v):
            return []

        flat_pairs = []
        flat_meta = []
        for idle_idx, vehicle in enumerate(idle_vehicles):
            for candidate in candidates_by_v[vehicle.id]:
                flat_pairs.append((
                    candidate['v_idx'],
                    candidate['r_slot_idx'],
                    candidate['is_reject'],
                    candidate['rel_feat'],
                ))
                flat_meta.append((idle_idx, candidate))

        if not flat_pairs:
            return []

        scores = self._score_flat_pairs(snapshot, flat_pairs)
        return self._hungarian_actions(env, idle_vehicles, candidates_by_v, flat_meta, scores)

    def _score_flat_pairs(self, snapshot, flat_pairs):
        (
            vehicle_static, vehicle_nodes,
            request_static, request_nodes, request_mask,
            time_norm, global_stats, pair_agg,
        ) = self._snapshot_to_batched_tensors(snapshot)
        v_ctx, r_ctx, g_ctx = self.model.encode_context(
            vehicle_static, vehicle_nodes,
            request_static, request_nodes, request_mask,
            time_norm, global_stats,
        )
        pair_count = len(flat_pairs)
        pair_batch_idx = tf.zeros((pair_count,), dtype=tf.int32)
        pair_v_idx = tf.constant([pair[0] for pair in flat_pairs], dtype=tf.int32)
        pair_r_idx = tf.constant([pair[1] for pair in flat_pairs], dtype=tf.int32)
        pair_is_reject = tf.constant([float(pair[2]) for pair in flat_pairs], dtype=tf.float32)
        pair_rel = tf.constant(np.stack([pair[3] for pair in flat_pairs]).astype(np.float32))
        return self.model.score_pairs(
            v_ctx, r_ctx, g_ctx,
            pair_batch_idx, pair_v_idx, pair_r_idx, pair_is_reject, pair_rel,
            pair_agg_batch=pair_agg,
        ).numpy()

    def _hungarian_actions(self, env, idle_vehicles, candidates_by_v, flat_meta, scores):
        inf = 1e9
        vehicle_count = len(idle_vehicles)
        request_count = len(env.active_request_list)
        column_count = request_count + vehicle_count
        cost = np.full((vehicle_count, column_count), inf, dtype=np.float32)

        for (idle_idx, candidate), score in zip(flat_meta, scores):
            column = request_count + idle_idx if candidate['is_reject'] else candidate['r_slot_idx']
            cost[idle_idx, column] = -float(score)

        row_idx, col_idx = linear_sum_assignment(cost)
        actions = []
        for idle_idx, column in zip(row_idx, col_idx):
            if cost[idle_idx, column] >= inf:
                continue
            vehicle = idle_vehicles[idle_idx]
            if column < request_count:
                candidate = self._find_candidate(candidates_by_v[vehicle.id], column)
                if candidate is None:
                    continue
                request = candidate['r']
                action_type = candidate['action_type']
                action_id = self._make_action_id(request, action_type)
            else:
                candidate = next((c for c in candidates_by_v[vehicle.id] if c['is_reject']), None)
                if candidate is None:
                    continue
                request = None
                action_type = ActionType.REJECT
                action_id = None

            actions.append({
                'vehicle_idx': vehicle.id,
                'action_type': action_type,
                'request': request,
                'pair_info': {
                    'v_idx': candidate['v_idx'],
                    'r_slot_idx': candidate['r_slot_idx'],
                    'is_reject': candidate['is_reject'],
                    'rel_feat': candidate['rel_feat'],
                },
                'action_id': action_id,
                'mode': 'inference',
                'score': -float(cost[idle_idx, column]),
            })
        return actions

    @staticmethod
    def _find_candidate(candidates, r_slot_idx):
        for candidate in candidates:
            if not candidate['is_reject'] and candidate['r_slot_idx'] == r_slot_idx:
                return candidate
        return None

    @staticmethod
    def _make_action_id(request, action_type):
        if request is None:
            return None
        return f"{request.id}_{action_type.value}"
