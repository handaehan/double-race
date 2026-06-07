# 로고 자산 라이브러리

종목별 로고 PNG 를 이 폴더에 넣고 `db/manifest.json` 에 `logo` 필드를 추가하면
드롭다운 / 끝점 아이콘 / 브랜드 컬러 자동 추출이 동시에 작동합니다.

## 파일 규칙
- 파일명: `<symbol>.png` (또는 `.svg`, `.webp`)
  - 예: `nvda.png`, `tsla.png`, `aapl.png`, `btc.png`
- 권장 크기: 256×256 정사각 / 투명 배경
- 색 추출용: 단색 백그라운드 권장 (흰/검 배경은 자동 무시됨)

## manifest 연결
`db/manifest.json` 의 해당 ticker 엔트리에 한 줄 추가:

```json
"nvda": {
  ...,
  "logo": "assets/logos/nvda.png"
}
```

추가하면 자동으로:
1. 비교 종목 드롭다운 / 끝점 아이콘에 로고 표시
2. 로고 이미지에서 대표 색 자동 추출 → 그래프 선·글로우·영역·텍스트 모두 동일 컬러
3. 추출 실패 시 `SERIES_META[symbol].color` 또는 기본 색상 폴백

## 색상 우선순위 (script.js 의 `_resolveSeriesColor`)
1. `MANIFEST.tickers[sym]._extractedColor` (로고에서 추출)
2. `SERIES_META[sym].color` (수동 명시 — 권장 브랜드 컬러)
3. `DEFAULT_COLORS[i % N]` (마지막 폴백)

## 추가 안내
- 로고 없이도 `SERIES_META` 에 색만 지정하면 색 자동 적용 가능.
- 로고 없는 종목은 끝점 아이콘이 자동으로 텍스트 약어 (예: "NVDA") 로 표시됨.
