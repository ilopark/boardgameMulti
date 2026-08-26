# 카드 그림 넣는 곳

여기에 파일을 넣으면 자동으로 카드에 쓰인다. **없으면 SVG 문장으로 그려진다** (지금 상태).

## 파일 이름

확장자는 `.png` `.jpg` `.webp` 아무거나.

**숫자카드 — `색_숫자.png` 로 넣으면 숫자까지 그려진 완성 카드를 그대로 쓴다.**
(이 방식이 우선. 색 공용 한 장만 넣으면 `green.png`처럼 두고 숫자는 코드가 얹는 폴백도 여전히 동작.)
```
green_1.png … green_14.png     앵무새 (초록)
yellow_1.png … yellow_14.png   보물상자 (노랑)
purple_1.png … purple_14.png   지도 (보라)
black_1.png … black_14.png     졸리로저 (검정, 트럼프)
```

**특수카드**
```
escape.png      도주
pirate.png      해적 (5장 공용)
mermaid.png     인어
skullking.png   스컬킹
tigress.png     티그리스
kraken.png      크라켄
whitewhale.png  흰고래
```

해적 5명을 각각 다르게 하고 싶으면 아래 이름을 쓴다. 없으면 `pirate.png`를 공용으로 쓴다.
```
pirate-rosie.png  pirate-bahij.png  pirate-rascal.png
pirate-juanita.png  pirate-harry.png
```

즉 **최소 12장**이면 전부 채워진다.

## 규격

- 세로형 카드 비율 **5:7** (예: 500×700)
- **완성 카드 그림**을 넣으면 코드가 숫자·이름 오버레이를 그리지 않는다 (그림에 이미 있으므로). 카드 전체가 꽉 차게 렌더된다.
- 색 공용 폴백(`green.png`)을 쓸 때만 코드가 왼쪽 위 숫자 + 아래 이름 라벨을 얹는다

## 저작권 주의

이 레포는 **공개 상태**다. 시판 제품의 카드 스캔이나 공식 아트를 넣으면
저작물 무단 배포가 된다. 직접 만들었거나 상업적 이용이 허용된 이미지만 넣을 것.
로컬에서만 쓰고 싶으면 `.gitignore`에 `web/src/assets/cards/*.png` 를 추가하면 된다.
