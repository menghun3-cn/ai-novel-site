#!/usr/bin/env sh
# Novel Web Publisher 重建 + 启动
# 用法: ./rebuild.sh                  # 构建镜像并启动/更新容器(默认不含本地 TTS)
#       ./rebuild.sh --clean          # 不用缓存,完全重建(依赖清单变更后如遇缓存异常再用)
#       ./rebuild.sh --tts            # 启用本地 Kokoro TTS(kokoro-js-zh + onnxruntime-node)
#       ./rebuild.sh --tts --model    # 同时自动下载中文模型权重到 ./models/kokoro(推荐)
#       ./rebuild.sh --clean --tts    # 组合参数,顺序不限
set -e
cd "$(dirname "$0")"

# ── 参数解析 ────────────────────────────────────────────────────────────────
CLEAN=0
ENABLE_TTS=0
FETCH_MODEL=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --tts)   ENABLE_TTS=1 ;;
    --model) FETCH_MODEL=1 ;;
    *)
      echo "[rebuild] 未知参数: $arg"
      echo "  可用: --clean | --tts | --model"
      exit 2
      ;;
  esac
done

BUILD_ARGS=""
if [ "$ENABLE_TTS" = "1" ]; then
  BUILD_ARGS="$BUILD_ARGS --build-arg ENABLE_LOCAL_TTS=1"
  echo "[rebuild] 启用本地 Kokoro TTS:镜像将内置 kokoro-js-zh + onnxruntime-node"
  # onnxruntime-node 预编译二进制走 GitHub releases,国内构建慢/失败时设置该环境变量:
  #   ONNX_BINARY_MIRROR=https://registry.npmmirror.com/-/binary/onnxruntime ./rebuild.sh --tts
  if [ -n "${ONNX_BINARY_MIRROR:-}" ]; then
    BUILD_ARGS="$BUILD_ARGS --build-arg ONNX_BINARY_MIRROR=$ONNX_BINARY_MIRROR"
    echo "[rebuild]   已透传 ONNX_BINARY_MIRROR=$ONNX_BINARY_MIRROR"
  fi
fi

# ── 模型下载(可选)───────────────────────────────────────────────────────────
# 中文语音 embedding 已随镜像内置;此处只拉模型权重 + config/tokenizer。
# 布局必须与 transformers.js 的加载约定一致:
#   subfolder 默认 'onnx' + q8 dtype → onnx/model_quantized.onnx
# (引擎 KOKORO_DTYPE='q8' 固定找 _quantized 后缀;下载 model.onnx 等其它文件不会被加载)
if [ "$FETCH_MODEL" = "1" ]; then
  echo "[rebuild] 下载 Kokoro 中文模型权重到 ./models/kokoro ..."
  mkdir -p models/kokoro/onnx
  HF_ENDPOINT="${KOKORO_HF_ENDPOINT:-https://hf-mirror.com}"
  BASE="$HF_ENDPOINT/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main"
  # 模型卡: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
  for f in config.json tokenizer.json tokenizer_config.json onnx/model_quantized.onnx; do
    dest="models/kokoro/$f"
    if [ ! -f "$dest" ]; then
      echo "  ⤓ $f"
      curl -fsSL --max-time 900 -o "$dest" "$BASE/$f" || { echo "  ✗ $f 下载失败(可重跑 --model 或手动放置)"; rm -f "$dest"; }
    else
      echo "  ✓ $f 已存在,跳过"
    fi
  done
  # 目录含 onnx/*.onnx 才算就绪;若失败但目录里已有 .onnx 也算就绪
  if ls models/kokoro/onnx/*.onnx >/dev/null 2>&1; then
    echo "  ✓ 模型就绪: models/kokoro/(onnx/model_quantized.onnx)"
  else
    echo "  ✗ 未检测到 onnx/*.onnx 权重,本地语音将回退 Edge 在线合成"
  fi
fi

# ── 构建 ────────────────────────────────────────────────────────────────────
if [ "$CLEAN" = "1" ]; then
  echo "[rebuild] 完全重建(不使用构建缓存)..."
  docker compose build --no-cache $BUILD_ARGS
else
  echo "[rebuild] 构建镜像(依赖未变时命中缓存)..."
  docker compose build $BUILD_ARGS
fi

echo "[rebuild] 启动容器..."
docker compose up -d

echo "[rebuild] 等待服务就绪..."
i=0
until curl -fsS -o /dev/null http://127.0.0.1:33000/ 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -ge 30 ]; then
    echo "[rebuild] 服务 30 次探测未就绪,查看日志: docker compose logs -f web"
    exit 1
  fi
  sleep 2
done

echo "[rebuild] 首页就绪,验证关键路由..."
errors=0
for path in / /books /register /login /shelf /me; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:33000${path}" 2>/dev/null)
  if [ "$status" -eq 200 ] || [ "$status" -eq 307 ] || [ "$status" -eq 308 ]; then
    echo "  ✓ ${path} → ${status}"
  else
    echo "  ✗ ${path} → ${status}"
    errors=$((errors+1))
  fi
done

if [ "$errors" -gt 0 ]; then
  echo "[rebuild] ${errors} 条路由异常,请检查部署!"
  exit 1
fi

# ── 本地 TTS 容器内验证(仅 --tts)────────────────────────────────────────────
if [ "$ENABLE_TTS" = "1" ]; then
  echo "[rebuild] 验证本地 Kokoro TTS(容器内合成中文音频)..."
  if docker compose exec -T web npm run test:tts-local; then
    echo "[rebuild] ✓ 本地语音引擎可用"
  else
    echo "[rebuild] ✗ 本地语音验证失败(可能模型未挂载/未下载,听书将回退 Edge)"
  fi
fi

echo "[rebuild] OK → http://<服务器IP>:33000  (全部路由验证通过)"
