# Konomi

[English](https://github.com/blackwaterbread/Konomi/blob/main/README.md)

Konomi는 사용자가 지정한 폴더를 스캔해서 메타데이터를 기반으로 검색/관리 기능을 제공하고 NovelAI 이미지 생성까지 한 곳에서 처리할 수 있도록 만든 Electron 데스크톱 앱입니다. 단순 뷰어가 아니라 "생성 → 아카이빙 → 검색 → 재활용" 흐름을 하나로 묶는 것을 목표로 합니다.

## 주요 기능

* 로컬 폴더 기반 관리
* NovelAI, WebUI PNG 메타데이터 호환
* 프롬프트, 태그, 해상도, 모델 검색 지원
* 즐겨찾기, 커스텀 카테고리, 랜덤 픽 기능
* 중복 파일 감지 및 폴더 추가 시 중복 해결 플로우
* Perceptual Hash + Jaccard 유사도 기반 하이브리드 유사 이미지 분석
* 프롬프트를 블록처럼 다루는 기능
* 재사용 가능한 프롬프트 그룹 기능
* 각종 고급/조건부 프롬프트 기능
* NovelAI API를 이용한 이미지 생성
* 이미지 자동 생성

## 빠른 시작

[Release](https://github.com/blackwaterbread/Konomi/releases) 탭에서 본인 환경에 맞는 설치파일 다운로드 후 설치

설정 방법, 아키텍처 설명, 또는 구현 세부 사항이 필요하다면 [README.dev.md](https://github.com/blackwaterbread/Konomi/blob/main/README.dev.md)를 참고하세요.

## 라이선스

이 프로젝트는 [BSD 2-Clause License](https://github.com/blackwaterbread/Konomi/blob/main/LICENSE)를 따릅니다.
