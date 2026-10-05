# Worker 해석과 취소 경계

DC·시간영역·AC 및 DC 포트 계산은 module Worker에서 실행됩니다. 계산 중 `계산 취소`를 누르거나 회로, 해석 설정, 포트 선택 또는 제외 부하를 바꾸면 현재 Worker를 `terminate()`하고 그 snapshot의 결과를 폐기합니다. 새 실행은 직전 작업의 종료를 기다리지 않고 새 Worker로 시작합니다.

한 번에 한 작업만 활성화됩니다. 각 응답은 요청 ID, 작업 종류, 회로 generation을 확인하고 DC 포트는 p/n·제외 부하 snapshot까지 다시 확인합니다. 따라서 종료된 Worker의 늦은 성공·오류나 과거 작업의 정리 단계가 새 결과와 버튼 상태를 덮어쓰지 않습니다.

Worker 경계는 구조화 복제를 사용합니다. 계산의 전체 표본, 복소수 객체, topology와 오류의 `name`, `code`, `message`, `hint`, `details`를 그대로 전달하며 JSON 왕복이나 동기 계산 fallback을 사용하지 않습니다. Worker 생성·module 로딩·메시지 복제 실패는 일반 회로 오류와 구분해 표시됩니다. 사용자 취소는 해석 오류가 아닙니다.

계산식과 포트 등가 계산은 각각 기존 `src/circuit-engine.js`, `src/port-analysis.js`를 그대로 호출합니다. 이번 변경은 계산 위치와 생명주기만 바꾸며 solver, 표시 축, 저장 JSON, CSV의 수치 의미는 바꾸지 않습니다.
