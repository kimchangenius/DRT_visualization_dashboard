# DRT Visualization Dashboard
A dashboard for simulating DRT vehicles in the Sioux-Falls Network and visualizing the simulation 
progress and results


### Conda 환경 생성

```bash
conda create -n drt_env python=3.10 -y
conda activate drt_env
pip install tensorflow==2.10.0
pip install -r server/requirements.txt
```

### 서버 실행

```bash
cd server
python server.py
```

## 클라이언트 환경 세팅

### 설치 및 실행

```bash
npm install
npm run dev
```