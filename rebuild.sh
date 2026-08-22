#!/usr/bin/env sh
# Novel Web Publisher 重建 + 启动
# 用法: ./rebuild.sh          # 构建镜像并启动/更新容器
#       ./rebuild.sh --clean  # 不用缓存,完全重建(依赖清单变更后如遇缓存异常再用)
set -e
cd "$(dirname "$0")"

if [ "$1" = "--clean" ]; then
  echo "[rebuild] 完全重建(不使用构建缓存)..."
  docker compose build --no-cache
else
  echo "[rebuild] 构建镜像(依赖未变时命中缓存)..."
  docker compose build
fi

echo "[rebuild] 启动容器..."
docker compose up -d

echo "[rebuild] 等待服务就绪..."
i=0
until curl -fsS -o /dev/null http://127.0.0.1:33000/api/health 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -ge 30 ]; then
    echo "[rebuild] 服务 30 次探测未就绪,查看日志: docker compose logs -f web"
    exit 1
  fi
  sleep 2
done

echo "[rebuild] OK → http://<服务器IP>:33000  (健康检查已通过)"
