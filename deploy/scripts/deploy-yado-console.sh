#!/bin/bash
# 芽豆管理端部署脚本。
# 由 GitHub Actions 经 SSH forced command 触发：标准输入是构建产物 dist 的 tar.gz，不接受任何参数。
# 每次发布解压到新的版本目录，校验通过后原子切换 current 软链；保留最近 5 个版本，回滚见 README。
set -euo pipefail

ROOT=/opt/yado/nginx/html/yado-console
RELEASES="$ROOT/releases"
KEEP=5
# 上传大小上限，防止异常输入占满磁盘；正常产物不到 1 MB
MAX_BYTES=$((20 * 1024 * 1024))

release="$(date +%Y%m%d%H%M%S)"
target="$RELEASES/$release"
echo "[$(date '+%F %T')] 开始发布管理端 ${release}"

mkdir -p "$RELEASES"
if [ -e "$target" ]; then
  echo "  版本目录已存在：${target}" >&2
  exit 1
fi

incoming="$(mktemp -d "$RELEASES/.incoming.XXXXXX")"
trap 'rm -rf "$incoming"' EXIT

head -c "$((MAX_BYTES + 1))" > "$incoming/dist.tar.gz"
if [ "$(stat -c %s "$incoming/dist.tar.gz")" -gt "$MAX_BYTES" ]; then
  echo "  产物超过 20 MB，拒绝发布" >&2
  exit 1
fi

mkdir "$incoming/files"
# 不还原属主与权限；GNU tar 默认拒绝绝对路径和含 .. 的成员
tar -xzf "$incoming/dist.tar.gz" -C "$incoming/files" --no-same-owner --no-same-permissions
# 产物里只允许普通文件和目录，软链可能指到站点目录以外
if [ -n "$(find "$incoming/files" ! -type f ! -type d -print -quit)" ]; then
  echo "  产物包含链接或特殊文件，拒绝发布" >&2
  exit 1
fi
if [ ! -f "$incoming/files/index.html" ]; then
  echo "  产物缺少 index.html，拒绝发布" >&2
  exit 1
fi

chmod -R u=rwX,go=rX "$incoming/files"
mv "$incoming/files" "$target"

# 原子切换：先建临时软链再 rename 覆盖，nginx 不会读到切换一半的状态。
# 用相对路径，nginx 容器里看到的路径不同也能解析
ln -sfn "releases/$release" "$ROOT/.current.tmp"
mv -T "$ROOT/.current.tmp" "$ROOT/current"
echo "  已切换到 ${release}"

# 只保留最近 KEEP 个版本
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9]{14}' -printf '%f\n' \
  | sort -r | tail -n +"$((KEEP + 1))" \
  | while read -r old; do rm -rf "${RELEASES:?}/${old}"; done

echo "[$(date '+%F %T')] 发布成功"
