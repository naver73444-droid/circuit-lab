# 세션 3 — 구현 및 실험 실행 인계

## 실행
프로젝트 루트에서:

```powershell
npm test
npm run check
node server.mjs 4173
```

브라우저에서 `http://127.0.0.1:4173`을 연다. 앱 자체는 외부 패키지 설치나 유료 API 없이 동작한다. Windows에서는 기존 `start-circuit-lab.cmd`도 보존했다. 이 채팅의 검증 환경은 Linux이므로 Windows CMD 자동 실행을 통과했다고 해석하지 않는다.

## 브라우저 회귀시험
선택적 개발 의존성: Python과 Playwright. 설치가 필요한 환경에서만 사용한다.

```powershell
python -m pip install playwright
python -m playwright install chromium
# 별도 터미널에서 node server.mjs 4173 실행 후:
python scripts/browser/browser_regression.py --base-url http://127.0.0.1:4173 --output artifacts/browser-http
```

로컬 HTTP 접근이 정책상 막힌 검토 환경에서 사용했던 경로:

```powershell
python scripts/browser/browser_regression.py --output artifacts/browser-offline
```

`--base-url`을 생략하면 HTML/CSS와 ES module import를 인라인 데이터 전송으로 바꾼 **오프라인 하네스**다. 앱 로직을 다른 로직으로 대신하지 않지만 서버·CSP·실제 URL 전달은 검증하지 않는다. 결과 JSON의 transport 값을 반드시 보고한다. `CIRCUIT_LAB_BROWSER` 환경변수로 설치된 브라우저 실행 파일 경로를 지정할 수 있다.

## 소스 내보내기/복원

```powershell
node scripts/export-source.mjs create ..\circuit-export Circuit-Lab-CIRCUIT-007-UX
node scripts/export-source.mjs restore-txt ..\circuit-export\Circuit-Lab-CIRCUIT-007-UX.txt ..\circuit-restored
node scripts/export-source.mjs verify ..\circuit-restored ..\circuit-export\source-manifest.tsv
```

복원 대상은 새 폴더 또는 빈 폴더여야 한다. 기존 파일을 덮어쓰지 않는다. unsafe 경로, 중복 경로, hash 오류, symlink 경로는 거부한다. verify는 manifest에 열거된 파일을 검사하며 manifest 외 추가 파일이 없다는 보장은 하지 않는다. exporter는 docs/Skill/시험까지 포함하지만 artifacts 결과 폴더는 포함하지 않는다.

## 변경 규칙
숫자 엔진 수정은 설계 세션이 제공한 기대값으로 확인한다. UI 변경에는 click, wheel, pointercancel, blur, import, re-run을 포함한다. 예제 버튼은 수동 run 없이 완료돼야 한다. 실제 단위/IC/배선은 사용자 선택 없이 바꾸지 않는다. JSON을 불러오는 것과 수치 해석을 성공하는 것은 별개다.
