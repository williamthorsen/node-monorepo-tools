#!/usr/bin/env bash
set -euo pipefail

case "$1" in
a)
  echo a >out.txt
  ;;
b)
  echo b >&2
  ;;
esac

if [ -f x ] && [ -f y ]; then
  echo both
fi

find . -name '*.ts' |
  sort |
  head -5
