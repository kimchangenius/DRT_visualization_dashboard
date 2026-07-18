# DRT Dashboard 연구 근거 및 VMT 적용 검토

작성일: 2026-07-18

이 문서는 대시보드의 거리 흐름, 공간 밀도, 색상, 흐름 지도, 이벤트 시퀀스,
연결 선택 설계를 검토할 때 사용한 연구와 공공 표준을 재확인해 정리한 것이다.
논문에 등장한다는 이유만으로 현재 구현을 정당화하지 않고, 실제 적용 여부와
한계를 함께 기록한다.

## 1. VMT 정의와 교통 분야의 계산식

### 1.1 도로 구간 교통량으로 계산하는 표준식

FHWA Highway Performance Monitoring System(HPMS)은 도로 구간별 일일 VMT를
다음과 같이 계산한다.

```text
DVMT_e = AADT_e * L_e
DVMT_network = sum_e(DVMT_e)
Annual VMT = 365 * DVMT_network
```

- `AADT_e`: 구간 `e`의 연평균 일교통량, 단위는 vehicle/day
- `L_e`: 구간 길이, 단위는 mile
- `DVMT_e`: 구간의 일일 vehicle-miles/day
- 연간 환산은 해당 일교통량이 연평균 일교통량일 때만 `365`를 곱한다.

핵심은 차량 한 대가 1 mile을 이동하면 승객 수와 무관하게 1 VMT라는 점이다.
승객 수를 곱한 값은 VMT가 아니라 PMT(passenger miles traveled)에 해당한다.

공식 근거:

- [FHWA HPMS Field Manual, Vehicle Miles of Travel](https://www.fhwa.dot.gov/policyinformation/hpms/fieldmanual/page07.cfm)
- [FHWA Traffic Monitoring Guide, VDT/VMT definitions](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2013/traffic-monitoring-theory.cfm)
- [US EPA MOVES Algorithms](https://www.epa.gov/moves/moves-algorithms)

### 1.2 개별 차량 궤적으로 계산하는 동등식

시뮬레이션처럼 모든 차량의 실제 경로가 있으면 AADT를 추정할 필요가 없다.
분석 구간 `I`에서 차량별 실제 주행 거리를 직접 합산한다.

```text
VMT(I) = sum_v sum_e d(v, e, I)
```

여기서 `d(v, e, I)`는 차량 `v`가 시간 구간 `I`에 edge `e`에서 실제로 이동한
거리(mile)다. 모든 edge를 완주했다면 이 식은 다음과 같이 HPMS 식과 동일해진다.

```text
VMT(I) = sum_e N_e(I) * L_e
```

`N_e(I)`는 구간 안에서 edge를 통과한 차량 횟수다. 부분 주행이 있으면
`N_e * L_e`보다 실제 부분 거리를 더하는 방식이 정확하다.

## 2. 현재 코드의 거리 계산식

관련 구현:

- `server/app/vehicle.py`: route와 edge별 실제 이동 거리 누적
- `server/app/state_builder.py`: Replay v4 `vehicleMovements` 및 `dispatchDecisions` 인코딩
- `src/utils/vehicleDistanceFlow.ts`: 선택 시간 구간 거리 절단 및 edge별 합산
- `src/components/VehicleOperationMap.tsx`: 선 굵기와 범례 표현

### 2.1 Replay 인코딩

각 이동 `m`과 edge `e`에 다음 값이 저장된다.

- `edge.distance = L_e`
- `edge.travelTime = T_e`
- `edge.distanceTravelled = D_m,e`, 단 `0 <= D_m,e <= L_e`
- `movement.startTime`, `movement.endTime`
- `movementType = pickup | dropoff`

서버는 edge 안에서 속도가 일정하다고 가정한다. 따라서 edge에서 실제로 이동한
시간의 비율과 거리 비율이 같다.

### 2.2 선택 시간 구간과 겹치는 거리

edge 진입 시각을 `a`, 선택 구간을 `[t0, t1)`, 실제 이동 완료 시각을
`b = a + T_e * (D_m,e / L_e)`라고 하면 겹치는 시간은 다음과 같다.

```text
delta_t = max(0, min(b, t1) - max(a, t0))
```

현재 `intervalDistance`가 계산하는 거리는 다음과 동등하다.

```text
d(m, e, I) = min(D_m,e, (L_e / T_e) * delta_t)
```

상태별 edge 누적값은 다음과 같다.

```text
D_e,pickup(I)   = sum_m 1[type(m)=pickup]  * d(m, e, I)
D_e,carrying(I) = sum_m 1[type(m)=dropoff] * d(m, e, I)
D_total(I)      = sum_e(D_e,pickup(I) + D_e,carrying(I))
```

이 방식은 프레임 위치를 샘플링해 근사하는 방식이 아니다. Replay에 저장된 실제
route edge와 부분 이동 비율을 사용한다. 다만 `edge_distance.csv` 값의 물리적
단위가 보장되지 않고 Sioux Falls network weight로 사용되므로, 현재 결과는
물리적 vehicle distance가 아니라 trajectory-based **Weighted Edge Usage**다.

## 3. 현재 계산을 VMT에 적용할 수 있는가

### 결론

**계산 구조는 VMT에 바로 적용할 수 있지만, 현재 표시값을 VMT라고 부를 수는
없다.** 현재 Replay의 `distanceUnit`이 `network_distance_unit`이고,
`edge_distance.csv`의 값이 mile이라는 데이터 계약이 없기 때문이다.

따라서 현재 UI 명칭은 `Weighted Edge Usage`를 사용한다. `Edge distance`는
edge 자체 길이로 오해될 수 있고, `VMT`는 mile 단위를 전제하므로 현재 데이터
계약에는 적절하지 않다.

### VMT로 승격하기 위한 조건

1. `edge_distance.csv`의 길이가 mile임을 원자료와 메타데이터로 보증하거나,
   명시적인 mile 변환 계수를 둔다.
2. Replay의 `distanceUnit`을 단순 문자열이 아니라 검증 가능한 단위 계약으로
   저장한다. 예: `mile`, 또는 `meter`와 변환 규칙.
3. 모든 차량 이동을 포함한다. 현재 서버 모델에는 이동하는 상태가 pickup과
   dropoff뿐이므로 현재 합계는 이 모델의 전체 차량 이동 거리와 같다.
4. 향후 cruising/repositioning이 추가되면 해당 이동도 Replay와 총 VMT에
   포함해야 한다. 제외하면 operational VMT가 과소 계산된다.
5. 승객 수를 VMT에 곱하지 않는다. 승객 수를 반영하려면 별도 PMT를 계산한다.
6. 한 번의 시뮬레이션 결과에 임의로 `365`를 곱하지 않는다. 해당 실행이
   평균 일일 운행을 대표한다는 실험 설계가 있을 때만 연간 환산한다.

### 현재 상태 분해의 교통학적 해석

```text
To-pickup task VDT = movementType이 pickup인 이동 거리
To-dropoff task VDT = movementType이 dropoff인 이동 거리
Total operational VDT = To-pickup task VDT + To-dropoff task VDT
```

현재 `pickup`은 승객을 태운 순간이 아니라 다음 pickup 지점으로 가는 작업을
뜻한다. 그러나 이미 다른 승객이 탑승한 차량도 용량과 서비스 제약이 허용하면
추가 pickup을 수행할 수 있다. 따라서 `pickup distance = empty VDT`가 아니며,
현재 Pickup/Carrying 구분은 **차량 점유 상태가 아니라 다음 작업 유형**이다.

현재 데이터로 계산 가능한 추천 파생 지표:

```text
To-pickup task ratio = To-pickup task VDT / Total operational VDT
To-dropoff task ratio = To-dropoff task VDT / Total operational VDT
Vehicle distance per accepted request = Total operational VDT / accepted requests
Vehicle distance per served request = Total operational VDT / served requests
```

Empty/occupied VDT, PMT, 거리 기반 평균 탑승률을 정확히 계산하려면 각 movement
시작 시점의 `onboardPassengerIds`와 `onboardPassengerCount`를 Replay에 직접
인코딩하는 것이 좋다. 현재 모델에서는 pickup/dropoff 이벤트가 movement 끝에서
발생하므로 한 movement 안의 탑승 인원은 일정하다. 이를 인코딩하면 다음이
가능하다.

```text
Empty VDT = sum d(m, e, I), where onboardPassengerCount(m) = 0
Occupied VDT = sum d(m, e, I), where onboardPassengerCount(m) > 0
PMT = sum d(m, e, I) * onboardPassengerCount(m)
Distance-weighted occupancy = PMT / Total operational VDT
```

## 4. Weighted Edge Usage 범례 판단

흐름 지도 연구에서는 선 굵기로 양을 표현하는 것이 일반적이다. 반면
`Edge distance`라는 고유 명칭이나, 한쪽이 뾰족한 쐐기 하나와 최댓값만 보여주는
범례가 표준인 것은 아니다.

Jenny et al.은 흐름의 방향 표현에서 tapered width보다 화살표가 더 효과적이며,
흐름의 양은 선 너비로 스케일링해야 한다고 보고했다. 현재 지도는 방향이 아니라
무방향 edge별 누적 가중 이용량을 주로 비교하므로 쐐기형 범례는 방향을 잘못
암시할 수 있다.

현재 적용 원칙:

- 명칭: `Weighted Edge Usage`
- 범례: 공통 최댓값의 10%, 50%, 100%에 해당하는 `Low`, `Medium`, `High`
  굵기 표본 3개
- 스케일: `sqrt(weightedUsage / commonMax)`를 사용해 큰 값의 시각적 독점을 완화
- 비교: Pickup/Carrying 필터를 바꿔도 같은 선택 구간 안에서는 공통 최댓값 유지
- 방향: edge tooltip에서만 방향별 거리와 traversal count 제공

이 선 굵기 변환은 값 자체의 통계 변환이 아니라 화면 인코딩이다. tooltip과
Pickup/Carrying 합계는 변환 전 Weighted Edge Usage를 표시한다.

### 4.1 Equivalent Edge Traversals와의 차이

edge `e`의 Sioux Falls weight를 `w_e`, movement `m`이 선택 구간에서 해당
edge를 실제로 이동한 비율을 `f_m,e`라고 하면 두 지표는 다음과 같다.

```text
Weighted Edge Usage_e = sum_m(w_e * f_m,e)
Equivalent Edge Traversals_e = sum_m(f_m,e)
```

완전 통과는 `f=1`, 절반 이동은 `f=0.5`다. 따라서 완전 통과 3회와 절반 이동
1회는 `3.5 equivalent traversals`가 된다. 현재처럼 선택 구간 경계에서
movement 일부만 포함되거나 edge 중간에서 이동이 종료된 경우도 실제 포함
비율만 더한다.

두 지표가 답하는 질문은 다르다.

- `Weighted Edge Usage`: 어느 edge에 network weight를 고려한 운행 부담이
  누적되었는가?
- `Equivalent Edge Traversals`: edge 자체 weight와 무관하게 차량이 어느
  edge를 얼마나 반복적으로 이용했는가?

예를 들어 weight가 10인 edge A를 2회 완전히 통과하고, weight가 2인 edge B를
8회 완전히 통과했다면 다음과 같다.

```text
A: Weighted Edge Usage = 20, Equivalent Edge Traversals = 2
B: Weighted Edge Usage = 16, Equivalent Edge Traversals = 8
```

Weighted Edge Usage 지도에서는 A가 더 강하게 나타나지만, Equivalent Edge
Traversals 지도에서는 B가 더 강하게 나타난다. 전자는 가중 운행량 비교에,
후자는 반복 이용·경로 집중도 비교에 적합하다. Equivalent Edge Traversals는
단위가 없고 직관적이라는 장점이 있지만, 긴 edge와 짧은 edge의 1회 통과를
동일하게 취급하므로 전체 운행 부담을 표현하는 데에는 한계가 있다.

## 5. 조사한 연구와 프로젝트 적용 관계

### 5.1 VMT, DRT, Mobility-on-Demand

1. **Henao, A., & Marshall, W. E. (2019). The impact of ride-hailing on
   vehicle miles traveled. Transportation, 46, 2173-2194.**
   [DOI](https://doi.org/10.1007/s11116-018-9923-2)
   - 승객 탑승 거리만 보면 운영 VMT를 과소평가하며 deadheading을 포함해야 한다.
   - 프로젝트 적용: 총 거리에는 모든 pickup/dropoff 이동을 포함한다. 다만 현재
     pickup 작업을 deadheading으로 간주하지 않고, 향후 onboard count를 인코딩해
     empty distance를 별도로 산출해야 한다.

2. **Chebance, Z., Markov, I., Guglielmetti, R., & Laumanns, M. (2021).
   Performance Comparison of Supply-Demand Matching Policies for On-Demand
   Mobility Services. Transportation Research Record, 2675(11).**
   [DOI](https://doi.org/10.1177/03611981211002840)
   - 평균 vehicle movement distance를 전체 fleet 주행거리/accepted demand로 정의한다.
   - 프로젝트 적용: 결과 비교용 distance per accepted/served request의 근거.

3. **Fagnant, D. J., & Kockelman, K. M. (2014). The travel and environmental
   implications of shared autonomous vehicles, using agent-based model
   scenarios. Transportation Research Part C, 40, 1-13.**
   [DOI](https://doi.org/10.1016/j.trc.2013.12.001)
   - SAV 시뮬레이션에서 빈 차 재배치가 전체 주행거리를 증가시킬 수 있음을 보인다.
   - 프로젝트 적용: repositioning 도입 시 총 VDT/VMT에서 제외하면 안 된다는 근거.

4. **Spieser, K., Treleaven, K., Zhang, R., Frazzoli, E., Morton, D., &
   Pavone, M. (2014). Toward a Systematic Approach to the Design and
   Evaluation of Automated Mobility-on-Demand Systems: A Case Study in
   Singapore. In Road Vehicle Automation, 229-245.**
   [DOI](https://doi.org/10.1007/978-3-319-05990-7_20)
   - 평균 trip distance를 승객 OD 거리와 수요 비대칭을 해소하는 empty distance로
     분해하고, EMD/Wasserstein-1을 최소 재정렬 거리의 하한으로 사용한다.
   - 프로젝트 적용: Demand-Operation Alignment의 향후 network-distance 기반 지표 후보.

5. **Zhang, R., & Pavone, M. (2016). Control of robotic mobility-on-demand
   systems: a queueing-theoretical perspective. The International Journal
   of Robotics Research, 35(1-3), 186-203.**
   [DOI](https://doi.org/10.1177/0278364915581863)
   - 수요 불균형과 차량 가용성을 queueing network와 rebalancing flow로 모델링한다.
   - 프로젝트 적용: 단순 공간 중첩률만으로 운영 정렬을 판단하지 않아야 하는 근거.

6. **Alonso-Mora, J., Samaranayake, S., Wallar, A., Frazzoli, E., & Rus, D.
   (2017). On-demand high-capacity ride-sharing via dynamic trip-vehicle
   assignment. PNAS, 114(3), 462-467.**
   [DOI](https://doi.org/10.1073/pnas.1611675114)
   - 동적 request-vehicle assignment를 wait time, delay, fleet 규모와 함께 평가한다.
   - 프로젝트 적용: 거리만 단독 KPI로 해석하지 않고 accept/reject, wait, detour와
     연결해 분석해야 하는 근거.

### 5.2 네트워크 및 공간 밀도

7. **Scott, D. W. (1992). Multivariate Density Estimation: Theory,
   Practice, and Visualization. Wiley.**
   [DOI](https://doi.org/10.1002/9780470316849)
   - 2차원 KDE의 Scott bandwidth rule은 표본 크기에 `n^(-1/6)` 스케일을 사용한다.
   - 프로젝트 적용: `estimateScottBandwidth`의 기본 이론. 현재 최소/최대 bandwidth
     clamp는 화면 안정성을 위한 프로젝트별 제약이다.

8. **Xie, Z., & Yan, J. (2008). Kernel Density Estimation of traffic
   accidents in a network space. Computers, Environment and Urban Systems,
   32(5), 396-406.**
   [DOI](https://doi.org/10.1016/j.compenvurbsys.2008.05.001)
   - 도로 위 사건은 평면 KDE보다 network-distance를 쓰는 NKDE가 더 자연스럽다고
     제안한다.
   - 프로젝트 적용 상태: 현재 Activity Heatmap은 평면 KDE다. 실제 도로 구간
     집중도를 논문 수준으로 분석하려면 NKDE 또는 현재 Distance Flow가 더 적절하다.

9. **LeBlanc, L. J., Morlok, E. K., & Pierskalla, W. P. (1975). An
   efficient approach to solving the road network equilibrium traffic
   assignment problem. Transportation Research, 9(5), 309-318.**
   [DOI](https://doi.org/10.1016/0041-1647(75)90030-1)
   - 현재 24-node, 76-arc Sioux Falls benchmark의 역사적 근거다.
   - 프로젝트 적용: benchmark topology 사용 근거이지, 현재 CSV의 `Length`가
     현실 Sioux Falls의 mile임을 자동 보증하는 근거는 아니다.

10. **Transportation Networks for Research Core Team. Transportation
    Networks for Research.**
    [Repository](https://github.com/bstabler/TransportationNetworks)
    - TNTP network 형식은 `Length`와 `Free Flow Time`을 별도 필드로 둔다.
    - 프로젝트 적용: edge distance 원자료의 계보를 문서화할 때 사용. 저장소
      형식 설명만으로 모든 network의 길이 단위를 mile로 일반화하면 안 된다.

### 5.3 색상과 정량 지도 표현

11. **Crameri, F., Shephard, G. E., & Heron, P. J. (2020). The misuse of
    colour in science communication. Nature Communications, 11, 5444.**
    [DOI](https://doi.org/10.1038/s41467-020-19160-7)
    - rainbow처럼 지각적으로 불균일한 색상은 데이터 차이를 왜곡할 수 있다.
    - 프로젝트 적용: 순서형 밀도에는 명도 순서가 분명한 sequential scheme 사용.

12. **Brewer, C. A., Hatchard, G. W., & Harrower, M. A. (2003).
    ColorBrewer in print: A catalog of color schemes for maps.
    Cartography and Geographic Information Science, 30(1), 5-32.**
    [DOI](https://doi.org/10.1559/152304003100010929)
    - sequential, diverging, qualitative 색상 체계를 데이터 의미에 맞게 분리한다.
    - 프로젝트 적용: KDE quartile은 sequential, Pickup/Carrying은 qualitative로 처리.

13. **Cleveland, W. S., & McGill, R. (1984). Graphical Perception:
    Theory, Experimentation, and Application to the Development of Graphical
    Methods. Journal of the American Statistical Association, 79(387),
    531-554.**
    [DOI](https://doi.org/10.1080/01621459.1984.10478080)
    - 위치와 길이가 각도와 면적보다 정밀한 비교에 유리하다.
    - 프로젝트 적용: node 내부 pie는 status 구성의 빠른 확인용이다. 노드 간
      Accepted/Pending/Cancelled의 정밀 비교는 숫자나 정렬 막대가 더 적합하다.

### 5.4 흐름 지도와 범례

14. **Jenny, B., Stephen, D. M., Muehlenhaus, I., Marston, B. E., Sharma,
    R., Zhang, E., & Jenny, H. (2018). Design principles for
    origin-destination flow maps. Cartography and Geographic Information
    Science, 45(1), 62-75.**
    [DOI](https://doi.org/10.1080/15230406.2016.1262280)
    - flow width를 양에 맞게 스케일링하고, 방향은 tapered line보다 arrowhead가
      효과적이라고 보고한다.
    - 프로젝트 적용: 쐐기형 거리 범례 제거와 일정 굵기 선 표본 범례의 근거.

15. **Koylu, C., & Guo, D. (2017). Design and evaluation of line
    symbolizations for origin-destination flow maps. Information
    Visualization, 16(4), 309-331.**
    [DOI](https://doi.org/10.1177/1473871616681375)
    - line width, color, taper, arrowhead 등 flow symbolization의 과업별 성능을
      비교한다.
    - 프로젝트 적용: 선 굵기는 양, 색은 운행 상태라는 시각 변수 분리의 근거.

### 5.5 시간 이벤트와 연결된 다중 뷰

16. **Monroe, M., Lan, R., Lee, H., Plaisant, C., & Shneiderman, B.
    (2013). Temporal Event Sequence Simplification. IEEE Transactions on
    Visualization and Computer Graphics, 19(12), 2227-2236.**
    [DOI](https://doi.org/10.1109/TVCG.2013.200)
    - 시간 이벤트를 정렬하고 집계해 sequence pattern을 탐색하는 EventFlow 접근을
      제시한다.
    - 프로젝트 적용: Event Sequence bar에서 동일 시각 event stacking과 선택 강조.

17. **Becker, R. A., & Cleveland, W. S. (1987). Brushing Scatterplots.
    Technometrics, 29(2), 127-142.**
    [DOI](https://doi.org/10.1080/00401706.1987.10488204)
    - 한 뷰에서 선택한 데이터 대상을 다른 뷰에서 동시에 강조하는 linked brushing의
      근거다.
    - 프로젝트 적용: event/request 선택을 timeline, onboard chart, map에 연결.

18. **Shneiderman, B. (1996). The Eyes Have It: A Task by Data Type
    Taxonomy for Information Visualizations. IEEE Symposium on Visual
    Languages, 336-343.**
    [DOI](https://doi.org/10.1109/VL.1996.545307)
    - overview, zoom/filter, details-on-demand 순서의 분석 상호작용 원칙을 제시한다.
    - 프로젝트 적용: 전체 차량 pattern을 먼저 보이고 구간 선택과 상세 진단으로
      내려가는 Result Analysis 흐름의 근거.

## 6. 연구 근거를 사용할 때의 제한

- 연구 근거는 특정 색상 hex 값이나 UI 크기를 자동으로 정답으로 만들지 않는다.
- KDE는 탐색적 밀도 표현이며 통계적 유의성 검정이나 인과관계를 제공하지 않는다.
- Sioux Falls는 집계된 benchmark network다. 실제 도시의 거리, 용량, 속도라고
  해석하려면 별도의 데이터 출처와 단위 검증이 필요하다.
- Pickup/Carrying 지도는 알고리즘 성능의 원인을 단독으로 증명하지 않는다.
  acceptance, cancellation, wait time, detour, fleet availability와 함께 해석해야 한다.
- S1과 S3 결과 비교에서는 동일한 거리 단위, 동일한 네트워크, 동일한 범례 척도를
  유지해야 선 굵기와 합계의 직접 비교가 가능하다.

## 7. 권장 후속 구현 순서

1. edge 길이의 원자료와 단위를 확정하고 Replay에 `mile` 또는 `meter`로 기록한다.
2. 단위가 mile로 확정되면 `Vehicle-distance`를 `VMT`로 승격한다.
3. `Total`, `Empty`, `Occupied`, `per served request`, `empty-distance ratio`를
   Result Analysis의 동일한 시간 구간에 대해 계산한다.
4. movement별 onboard count를 인코딩해 empty/occupied VDT, PMT,
   distance-weighted occupancy를 추가한다.
5. repositioning/cruising이 모델에 생기면 별도 movement type과 VMT 구성요소로
   추가한다.
6. S1/S3 비교 시 두 결과에 공통 거리 범례 최댓값을 적용해 시각 비교를 보장한다.
