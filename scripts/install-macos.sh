#!/bin/bash
set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
target_dir="$HOME/develop/codexteams"
copy_only=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      [ "$#" -ge 2 ] || { echo '--target 경로가 필요합니다.' >&2; exit 2; }
      target_dir="$2"; shift 2 ;;
    --copy-only) copy_only=true; shift ;;
    --help)
      echo '사용법: bash scripts/install-macos.sh [--target 경로] [--copy-only]'; exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done

if [ "$copy_only" = false ] && [ "$(uname -s)" != Darwin ]; then
  echo '이 설치 명령은 macOS용입니다. 소스 복사 검증에는 --copy-only를 사용하세요.' >&2
  exit 2
fi
if [ -L "$target_dir" ]; then
  echo '대상 폴더가 심볼릭 링크입니다. 실제 대상 경로를 지정하세요.' >&2; exit 2
fi

parent_dir="$(dirname "$target_dir")"
mkdir -p "$parent_dir"
parent_dir="$(cd "$parent_dir" && pwd -P)"
target_dir="$parent_dir/$(basename "$target_dir")"

if [ "$target_dir" != "$source_dir" ]; then
  case "$target_dir/" in "$source_dir/"*) echo '소스 내부로 복사할 수 없습니다.' >&2; exit 2 ;; esac
  if [ -e "$target_dir" ]; then
    [ -d "$target_dir" ] || { echo '대상 경로가 폴더가 아닙니다.' >&2; exit 2; }
    [ -z "$(ls -A "$target_dir")" ] || { echo "기존 폴더를 덮어쓰지 않습니다: $target_dir" >&2; exit 2; }
  else
    mkdir "$target_dir"
  fi
  copy_archive="$(mktemp "${TMPDIR:-/tmp}/codexteams-copy.XXXXXX")"
  trap 'rm -f "$copy_archive"' EXIT
  tar -C "$source_dir" --exclude='./node_modules' --exclude='./.git' --exclude='./.codexteams' --exclude='*.tgz' --exclude='*.zip' -cf "$copy_archive" .
  tar -C "$target_dir" -xf "$copy_archive"
  rm -f "$copy_archive"
  trap - EXIT
fi

echo "프로젝트 소스: $target_dir"
if [ "$copy_only" = true ]; then exit 0; fi

command -v node >/dev/null || { echo 'Node 22.19 이상을 먼저 설치하세요.' >&2; exit 2; }
command -v npm >/dev/null || { echo 'npm이 필요합니다.' >&2; exit 2; }
command -v pi >/dev/null || { echo 'Pi 1.4.x를 먼저 설치하세요: npm install -g @earendil-works/pi-coding-agent@1.4.0' >&2; exit 2; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<19))process.exit(2)' || { echo 'Node 22.19 이상이 필요합니다.' >&2; exit 2; }
pi_version="$(pi --version)"
node -e 'const m=process.argv[1].match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/); if(!m||Number(m[1])!==1||Number(m[2])<4)process.exit(2)' "$pi_version" || { echo 'Pi >=1.4.0 <2가 필요합니다. 현재 버전을 확인하세요.' >&2; exit 2; }

cd "$target_dir"
npm ci --ignore-scripts --no-audit --no-fund
npm install -g --ignore-scripts --omit=dev --legacy-peer-deps "$target_dir"
pi install "$target_dir"
echo '설치 명령이 완료됐습니다. 작업할 프로젝트에서 codexteams를 실행하세요. 기존 Pi에서는 /reload 후 /teams help를 실행하세요.'
