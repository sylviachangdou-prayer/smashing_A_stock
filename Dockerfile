# Hugging Face Space（Docker SDK）镜像。
# 这里只跑数据服务；前端在 Cloudflare Workers 上，通过 NEXT_PUBLIC_API_BASE 指过来。
# HF 要求 Dockerfile 位于仓库根目录。
FROM python:3.12-slim

# akshare 的部分依赖需要编译。
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ \
    && rm -rf /var/lib/apt/lists/*

# HF 约定容器以 uid 1000 运行。
RUN useradd -m -u 1000 user
RUN pip install --no-cache-dir uv

WORKDIR /app
COPY --chown=user:user pyproject.toml uv.lock ./

USER user
ENV HOME=/home/user \
    UV_PROJECT_ENVIRONMENT=/home/user/venv \
    PATH=/home/user/venv/bin:$PATH

# 按 uv.lock 锁定的版本安装，线上与本机一致。
RUN uv sync --frozen --no-dev

COPY --chown=user:user backend ./backend

# /app 在容器里不可写，缓存放到家目录。休眠重启后会清空，属于预期。
ENV STOCK_TOOL_CACHE_DIR=/home/user/cache \
    PYTHONUNBUFFERED=1

# HF Docker Space 默认对外暴露 7860。
EXPOSE 7860
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
