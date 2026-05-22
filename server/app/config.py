# ===========================================================================
# 시뮬레이션 / 환경
# ===========================================================================
MAX_NUM_VEHICLES = 4
VEH_CAPACITY = 6
MAX_WAIT_TIME = 10
MAX_INVEHICLE_TIME = 10
NUM_NODES = 24

# ===========================================================================
# 모델 입력 차원
# ===========================================================================
VEHICLE_RAW_DIM = 5
REQUEST_RAW_DIM = 7
RELATION_INPUT_DIM = 2
GLOBAL_STATS_DIM = 8
PAIR_AGG_DIM = 10
PAIR_AGG_COUNT_NORM_CAP = 48.0
NODE_EMB_DIM = 16

# 학습은 서버에서 수행하지 않지만, 저장된 weight 파일명과 UI 메타 표시를 위해 보관한다.
HIDDEN_DIM = 128
BATCH_SIZE = 32
LEARNING_RATE = 1e-4
DEFAULT_MODEL_CONFIG = {
    'hidden_dim': HIDDEN_DIM,
    'batch_size': BATCH_SIZE,
    'learning_rate': LEARNING_RATE,
}

DEFAULT_SCENARIO_CONFIG = {
    'scenario': 'S1',
    'scenario_seed': 0,
    'n_req': 320,
    'horizon': 240,
    'lambda_base': 1.0,
    'lambda_high': 6.0,
    'pop_p': 0.75,
}

scenario_config_list = [DEFAULT_SCENARIO_CONFIG]
TEST_SCENARIOS = ['S1', 'S2', 'S3', 'S4']
TEST_SCENARIO_SEEDS = list(range(10000, 10030))
