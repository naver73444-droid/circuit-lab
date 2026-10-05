# 실험 실행 세션 전달 — Dark UX 재검토

별도 branch/worktree 또는 새 폴더를 사용한다. 기준은 input의 source-ux-candidate이며 baseline을 덮어쓰지 않는다. 전체131 Node, 경계 검사(오류0/경고1), 실제 Node HTTP13을 재현한다. Windows 실행기에 문제가 있으면 `node server.mjs 4191`로 직접 실행하고 오류 출력을 보존한다.

```powershell
node --test tests/*.test.mjs
node scripts/check-boundaries.mjs
node scripts/scan-duplicates.mjs
node server.mjs 4191
# 별도 검증 터미널; 준비된 Python/Playwright만 사용
python scripts/browser/browser_regression.py --root . --output ./artifacts/browser-http --base-url http://127.0.0.1:4191
python scripts/browser/audit_browser.py --root . --output ./artifacts/audit-http --base-url http://127.0.0.1:4191
```

원 U 잔여 중 스크립트에 없는 경로는 protocol을 따라 별도 수동 관측한다. 실제 HTTP URL·OS·Node·브라우저·viewport·입력 순서·기대/실측·screenshot·raw/CSV·console 오류를 함께 기록한다. 마지막 AC 표본 및 비균일 표본 cursor, narrow peak/gap을 생략하지 않는다.

미확정 banana/빈 값/1e309를 다른 부품 선택 후에도 실행/저장하지 않는지, 입력 취소/회로 전환 확인, probe 삭제 undo, Shift/Alt축 분리, theme의 원값 불변, 악성 color import rollback을 재현한다. 실touch/OS DPI/125·150% zoom은 지원 환경별로 실행 또는 미실행 사유를 쓴다.

사용자 허락 없이 외부 Skill/추가 프레임워크를 활성화하거나 사이트에 재배포하지 않는다. 개선 수치 조건과 OP AMP 계획의 미구현 표기를 그대로 유지한다. 끝나면 변경 파일·시험 로그·확인하지 못한 점을 관리 세션에 전달하고 승인 전에는 완료/배포로 표시하지 않는다.
