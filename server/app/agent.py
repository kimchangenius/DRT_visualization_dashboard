import os
import numpy as np
import tensorflow as tf
import app.config as cfg

from tensorflow.keras.models import Model
from tensorflow.keras.layers import Input, Dense, TimeDistributed, Lambda, Concatenate, RepeatVector


class DQNAgent:
    def __init__(self, hidden_dim):
        self.hidden_dim = hidden_dim
        self.model = self.build_model()

    def load_model(self, file_path):
        if os.path.exists(file_path):
            self.model.load_weights(file_path)
            print(f"Model weights loaded at {file_path}")
        else:
            print(f"No model weights found at {file_path}")

    def save_model(self, file_path):
        self.model.save_weights(file_path)
        print(f"Model weights saved at {file_path}")

    def build_model(self):
        vehicle_input = Input(shape=(cfg.MAX_NUM_VEHICLES, cfg.VEHICLE_INPUT_DIM), name="vehicle_input")
        request_input = Input(shape=(cfg.MAX_NUM_REQUEST, cfg.REQUEST_INPUT_DIM), name="request_input")
        relation_input = Input(shape=(cfg.MAX_NUM_VEHICLES, cfg.MAX_NUM_REQUEST, cfg.RELATION_INPUT_DIM), name="relation_input")

        v_embed = TimeDistributed(Dense(self.hidden_dim, activation='relu'))(vehicle_input)
        r_embed = TimeDistributed(Dense(self.hidden_dim, activation='relu'))(request_input)

        v_expand = Lambda(lambda x: tf.expand_dims(x, axis=2))(v_embed)
        r_expand = Lambda(lambda x: tf.expand_dims(x, axis=1))(r_embed)

        v_tiled = Lambda(lambda x: tf.tile(x, [1, 1, cfg.MAX_NUM_REQUEST, 1]))(v_expand)
        r_tiled = Lambda(lambda x: tf.tile(x, [1, cfg.MAX_NUM_VEHICLES, 1, 1]))(r_expand)

        pair_embed = Concatenate(axis=-1)([v_tiled, r_tiled, relation_input])

        q_match = TimeDistributed(TimeDistributed(Dense(self.hidden_dim, activation='relu')))(pair_embed)
        q_match = TimeDistributed(TimeDistributed(Dense(1)))(q_match)
        q_match = Lambda(lambda x: tf.squeeze(x, axis=-1))(q_match)

        r_summary = Lambda(lambda x: tf.reduce_mean(x, axis=1))(r_embed)
        r_summary = RepeatVector(cfg.MAX_NUM_VEHICLES)(r_summary)
        reject_context = Concatenate(axis=-1)([v_embed, r_summary])

        q_reject = TimeDistributed(Dense(self.hidden_dim, activation='relu'))(reject_context)
        q_reject = TimeDistributed(Dense(1))(q_reject)

        q_total = Concatenate(axis=-1)([q_match, q_reject])

        return Model(inputs=[vehicle_input, request_input, relation_input], outputs=q_total)

    def act(self, state, action_mask):
        q_values = self.model.predict(state, verbose=0)
        masked_q = np.where(action_mask == 1, q_values, -1e2)
        flat_idx = int(np.argmax(masked_q.reshape(-1)))
        vehicle_idx = flat_idx // cfg.POSSIBLE_ACTION
        action_idx = flat_idx % cfg.POSSIBLE_ACTION
        return [vehicle_idx, action_idx, {'mode': 'dqn'}]
