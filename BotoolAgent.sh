#!/bin/bash
# Botool 开发代理 v2.0 - 带鲁棒性改进的长时间运行 AI 代理循环
# 用法: ./BotoolAgent.sh [最大迭代次数]
# 基于 Geoffrey Huntley 的 Ralph 模式
#
# v2.0 改进:
# - 超时机制（每次迭代 30 分钟）
# - 每次迭代前检查网络连接
# - 进程健康监控（检测卡死的进程）
# - 自动重试机制（每次迭代最多 3 次重试）
# - 迭代日志保存到文件

# 注意：不使用 set -e，因为我们需要手动处理错误
# 特别是 timeout 返回非零退出码时不应该导致脚本退出

# ============================================================================
# 进程管理 - 确保脚本退出时清理它启动的进程
# ============================================================================
CLAUDE_PID=""

cleanup() {
  echo ""
  echo ">>> 收到退出信号，正在清理..."
  if [ -n "$CLAUDE_PID" ] && kill -0 "$CLAUDE_PID" 2>/dev/null; then
    echo ">>> 终止 Claude 进程 (PID: $CLAUDE_PID)"
    kill "$CLAUDE_PID" 2>/dev/null
    wait "$CLAUDE_PID" 2>/dev/null
  fi
  update_status "stopped" "用户停止或脚本退出"
  echo ">>> 清理完成"
  exit 0
}

# 捕获退出信号
trap cleanup SIGINT SIGTERM EXIT

# ============================================================================
# 默认配置
# ============================================================================
MAX_ITERATIONS=10
ITERATION_TIMEOUT=1800  # 每次迭代 30 分钟
MAX_RETRIES=3           # 每次迭代的重试次数
HEALTH_CHECK_INTERVAL=10  # 健康检查间隔（秒）
STALL_THRESHOLD=30      # 连续 0% CPU 检查次数阈值（5 分钟）
NETWORK_RETRY_INTERVAL=30  # 网络检查重试间隔（秒）

# Rate Limiting 配置
RATE_LIMIT_ENABLED=true     # 是否启用 Rate Limiting
RATE_LIMIT_MAX_CALLS=100    # 时间窗口内最大调用次数
RATE_LIMIT_WINDOW=3600      # 时间窗口（秒），默认 1 小时
RATE_LIMIT_STATE_FILE=""    # Rate Limiting 状态文件（启动时设置）

# ============================================================================
# 加载 .botoolrc 配置文件（如果存在）
# ============================================================================
load_config() {
  local config_file="$SCRIPT_DIR/.botoolrc"

  if [ -f "$config_file" ]; then
    echo ">>> 加载配置文件: $config_file"
    # shellcheck source=/dev/null
    source "$config_file"
  fi

  # 环境变量覆盖配置文件
  [ -n "$BOTOOL_MAX_ITERATIONS" ] && MAX_ITERATIONS="$BOTOOL_MAX_ITERATIONS"
  [ -n "$BOTOOL_TIMEOUT" ] && ITERATION_TIMEOUT="$BOTOOL_TIMEOUT"
  [ -n "$BOTOOL_RETRIES" ] && MAX_RETRIES="$BOTOOL_RETRIES"
  [ -n "$BOTOOL_RATE_LIMIT_ENABLED" ] && RATE_LIMIT_ENABLED="$BOTOOL_RATE_LIMIT_ENABLED"
  [ -n "$BOTOOL_RATE_LIMIT_MAX_CALLS" ] && RATE_LIMIT_MAX_CALLS="$BOTOOL_RATE_LIMIT_MAX_CALLS"
  [ -n "$BOTOOL_RATE_LIMIT_WINDOW" ] && RATE_LIMIT_WINDOW="$BOTOOL_RATE_LIMIT_WINDOW"
}

# ============================================================================
# 解析参数
# ============================================================================
while [[ $# -gt 0 ]]; do
  case $1 in
    --timeout)
      ITERATION_TIMEOUT="$2"
      shift 2
      ;;
    --retries)
      MAX_RETRIES="$2"
      shift 2
      ;;
    *)
      # 如果是数字，假设是最大迭代次数
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

# ============================================================================
# 设置路径
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"
LOG_DIR="$SCRIPT_DIR/logs"
STATUS_FILE="$SCRIPT_DIR/.agent-status"
RATE_LIMIT_STATE_FILE="$SCRIPT_DIR/.rate-limit-state"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 加载配置
load_config

# ============================================================================
# 工具函数
# ============================================================================

# 更新状态文件供外部监控
update_status() {
  local status="$1"
  local message="$2"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

  # 计算进度
  local completed=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null || echo "0")
  local total=$(grep -c '"id": "DT-' "$PRD_FILE" 2>/dev/null || echo "0")
  local current_task=$(grep -o '## [0-9-]* - DT-[0-9]*' "$PROGRESS_FILE" 2>/dev/null | tail -1 | grep -o 'DT-[0-9]*' || echo "无")

  # Rate Limiting 状态
  local rate_limit_calls=0
  local rate_limit_max=$RATE_LIMIT_MAX_CALLS
  local rate_limit_window_remaining=0
  if [ "$RATE_LIMIT_ENABLED" = "true" ] && [ -f "$RATE_LIMIT_STATE_FILE" ]; then
    rate_limit_calls=$(grep -o '"callCount": [0-9]*' "$RATE_LIMIT_STATE_FILE" 2>/dev/null | grep -o '[0-9]*' || echo "0")
    local window_start=$(grep -o '"windowStart": [0-9]*' "$RATE_LIMIT_STATE_FILE" 2>/dev/null | grep -o '[0-9]*' || echo "0")
    local now=$(date +%s)
    local elapsed=$((now - window_start))
    rate_limit_window_remaining=$((RATE_LIMIT_WINDOW - elapsed))
    [ $rate_limit_window_remaining -lt 0 ] && rate_limit_window_remaining=0
  fi

  cat > "$STATUS_FILE" << EOF
{
  "status": "$status",
  "message": "$message",
  "timestamp": "$timestamp",
  "iteration": $CURRENT_ITERATION,
  "maxIterations": $MAX_ITERATIONS,
  "completed": $completed,
  "total": $total,
  "currentTask": "$current_task",
  "retryCount": ${RETRY_COUNT:-0},
  "rateLimit": {
    "enabled": $( [ "$RATE_LIMIT_ENABLED" = "true" ] && echo "true" || echo "false" ),
    "calls": $rate_limit_calls,
    "maxCalls": $rate_limit_max,
    "windowRemaining": $rate_limit_window_remaining
  }
}
EOF
}

# 检查到 Anthropic API 的网络连接
check_network() {
  curl -s --connect-timeout 5 --max-time 10 https://api.anthropic.com > /dev/null 2>&1
  return $?
}

# 等待网络恢复
wait_for_network() {
  if check_network; then
    return 0
  fi

  echo ">>> 网络不可用，等待连接..."
  update_status "waiting_network" "等待网络连接"

  while ! check_network; do
    sleep $NETWORK_RETRY_INTERVAL
    echo ">>> 检查网络中... ($(date '+%H:%M:%S'))"
  done

  echo ">>> 网络已恢复，继续执行..."
  return 0
}

# ============================================================================
# Rate Limiting 功能
# ============================================================================

# 获取当前时间戳（秒）
get_timestamp() {
  date +%s
}

# 初始化 Rate Limiting 状态
init_rate_limit() {
  if [ "$RATE_LIMIT_ENABLED" != "true" ]; then
    return 0
  fi

  # 如果状态文件不存在，创建初始状态
  if [ ! -f "$RATE_LIMIT_STATE_FILE" ]; then
    local now=$(get_timestamp)
    cat > "$RATE_LIMIT_STATE_FILE" << EOF
{
  "windowStart": $now,
  "callCount": 0,
  "lastCall": 0
}
EOF
    echo ">>> Rate Limiting 已初始化: 每 ${RATE_LIMIT_WINDOW}秒 最多 ${RATE_LIMIT_MAX_CALLS} 次调用"
  fi
}

# 读取 Rate Limiting 状态
read_rate_limit_state() {
  if [ ! -f "$RATE_LIMIT_STATE_FILE" ]; then
    init_rate_limit
  fi

  # 解析 JSON 状态文件
  RATE_WINDOW_START=$(grep -o '"windowStart": [0-9]*' "$RATE_LIMIT_STATE_FILE" | grep -o '[0-9]*')
  RATE_CALL_COUNT=$(grep -o '"callCount": [0-9]*' "$RATE_LIMIT_STATE_FILE" | grep -o '[0-9]*')
  RATE_LAST_CALL=$(grep -o '"lastCall": [0-9]*' "$RATE_LIMIT_STATE_FILE" | grep -o '[0-9]*')
}

# 更新 Rate Limiting 状态
update_rate_limit_state() {
  local window_start=$1
  local call_count=$2
  local last_call=$3

  cat > "$RATE_LIMIT_STATE_FILE" << EOF
{
  "windowStart": $window_start,
  "callCount": $call_count,
  "lastCall": $last_call
}
EOF
}

# 显示 Rate Limiting 状态
show_rate_limit_status() {
  if [ "$RATE_LIMIT_ENABLED" != "true" ]; then
    return 0
  fi

  read_rate_limit_state
  local now=$(get_timestamp)
  local window_elapsed=$((now - RATE_WINDOW_START))
  local window_remaining=$((RATE_LIMIT_WINDOW - window_elapsed))
  local calls_remaining=$((RATE_LIMIT_MAX_CALLS - RATE_CALL_COUNT))

  if [ $window_remaining -lt 0 ]; then
    window_remaining=0
  fi

  echo ">>> Rate Limiting 状态:"
  echo "    已使用: $RATE_CALL_COUNT/$RATE_LIMIT_MAX_CALLS 次调用"
  echo "    剩余: $calls_remaining 次调用"
  echo "    窗口重置: $((window_remaining / 60))分$((window_remaining % 60))秒后"
}

# 检查并等待 Rate Limit（如果需要）
# 返回 0 表示可以继续，返回 1 表示被阻止
check_rate_limit() {
  if [ "$RATE_LIMIT_ENABLED" != "true" ]; then
    return 0
  fi

  read_rate_limit_state
  local now=$(get_timestamp)
  local window_elapsed=$((now - RATE_WINDOW_START))

  # 检查是否需要重置时间窗口
  if [ $window_elapsed -ge $RATE_LIMIT_WINDOW ]; then
    echo ">>> Rate Limiting 时间窗口已重置"
    RATE_WINDOW_START=$now
    RATE_CALL_COUNT=0
    update_rate_limit_state $RATE_WINDOW_START 0 $RATE_LAST_CALL
    return 0
  fi

  # 检查是否超过限制
  if [ $RATE_CALL_COUNT -ge $RATE_LIMIT_MAX_CALLS ]; then
    local wait_time=$((RATE_LIMIT_WINDOW - window_elapsed))
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║  ⏳ Rate Limit 已达到上限                                         ║"
    echo "╠══════════════════════════════════════════════════════════════════╣"
    echo "║  已使用 $RATE_CALL_COUNT/$RATE_LIMIT_MAX_CALLS 次调用                           "
    echo "║  需要等待 $((wait_time / 60))分$((wait_time % 60))秒 后继续                      "
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""

    update_status "rate_limited" "Rate Limit 等待中，剩余 $wait_time 秒"

    # 显示倒计时
    while [ $wait_time -gt 0 ]; do
      printf "\r>>> 等待中... %02d:%02d " $((wait_time / 60)) $((wait_time % 60))
      sleep 10
      wait_time=$((wait_time - 10))

      # 每分钟更新一次状态
      if [ $((wait_time % 60)) -eq 0 ]; then
        update_status "rate_limited" "Rate Limit 等待中，剩余 $wait_time 秒"
      fi
    done
    echo ""

    # 重置时间窗口
    RATE_WINDOW_START=$(get_timestamp)
    RATE_CALL_COUNT=0
    update_rate_limit_state $RATE_WINDOW_START 0 $RATE_LAST_CALL
    echo ">>> Rate Limiting 时间窗口已重置，继续执行..."
  fi

  return 0
}

# 记录一次 API 调用
record_api_call() {
  if [ "$RATE_LIMIT_ENABLED" != "true" ]; then
    return 0
  fi

  read_rate_limit_state
  local now=$(get_timestamp)

  # 如果窗口已过期，重置
  local window_elapsed=$((now - RATE_WINDOW_START))
  if [ $window_elapsed -ge $RATE_LIMIT_WINDOW ]; then
    RATE_WINDOW_START=$now
    RATE_CALL_COUNT=1
  else
    RATE_CALL_COUNT=$((RATE_CALL_COUNT + 1))
  fi

  RATE_LAST_CALL=$now
  update_rate_limit_state $RATE_WINDOW_START $RATE_CALL_COUNT $RATE_LAST_CALL
}

# 后台监控进程健康
# 如果进程看起来卡住了返回 1
monitor_health() {
  local pid=$1
  local log_file=$2
  local stall_count=0
  local last_size=0

  while kill -0 $pid 2>/dev/null; do
    # 检查 CPU 使用率
    local cpu=$(ps -p $pid -o %cpu= 2>/dev/null | tr -d ' ' || echo "0")
    local cpu_int=${cpu%.*}

    # 同时检查日志文件是否在增长
    local current_size=$(stat -f%z "$log_file" 2>/dev/null || echo "0")

    if [ "$cpu_int" = "0" ] && [ "$current_size" = "$last_size" ]; then
      ((stall_count++))
      if [ $stall_count -ge $STALL_THRESHOLD ]; then
        echo ">>> 进程似乎卡住了（0% CPU 持续 $((stall_count * HEALTH_CHECK_INTERVAL)) 秒）"
        kill -9 $pid 2>/dev/null || true
        return 1
      fi
    else
      stall_count=0
    fi

    last_size=$current_size
    sleep $HEALTH_CHECK_INTERVAL
  done

  return 0
}

# 运行 claude 并带有超时（简化版，更可靠）
run_claude_with_monitoring() {
  local output_file=$1
  local log_file=$2

  # 查找 claude 命令的完整路径
  local CLAUDE_CMD=$(which claude 2>/dev/null || echo "$HOME/.claude/local/claude")

  # 检查 timeout 命令是否可用
  if command -v gtimeout &> /dev/null; then
    # macOS with coreutils - 后台运行并记录 PID
    gtimeout $ITERATION_TIMEOUT "$CLAUDE_CMD" --dangerously-skip-permissions --print < "$SCRIPT_DIR/CLAUDE.md" > "$output_file" 2>&1 &
    CLAUDE_PID=$!
    wait $CLAUDE_PID
  elif command -v timeout &> /dev/null; then
    # Linux or macOS with timeout
    timeout $ITERATION_TIMEOUT "$CLAUDE_CMD" --dangerously-skip-permissions --print < "$SCRIPT_DIR/CLAUDE.md" > "$output_file" 2>&1 &
    CLAUDE_PID=$!
    wait $CLAUDE_PID
  else
    # 没有 timeout 命令，直接运行（依赖 Claude 自己的机制）
    echo ">>> 警告：未找到 timeout 命令，直接运行 Claude（建议安装: brew install coreutils）"
    "$CLAUDE_CMD" --dangerously-skip-permissions --print < "$SCRIPT_DIR/CLAUDE.md" > "$output_file" 2>&1 &
    CLAUDE_PID=$!
    echo ">>> Claude PID: $CLAUDE_PID"
    wait $CLAUDE_PID
  fi
  local exit_code=$?

  # 清除 PID 记录
  CLAUDE_PID=""

  return $exit_code
}

# ============================================================================
# 如果分支变更，归档上次运行
# ============================================================================
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(grep -o '"branchName": "[^"]*"' "$PRD_FILE" 2>/dev/null | sed 's/"branchName": "//;s/"$//' || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    # 归档上次运行
    DATE=$(date +%Y-%m-%d)
    # 从分支名中去掉 "botool-dev/" 前缀
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^botool-dev/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

    echo "正在归档上次运行: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"

    # 同时归档日志
    if [ -d "$LOG_DIR" ] && [ "$(ls -A "$LOG_DIR" 2>/dev/null)" ]; then
      cp -r "$LOG_DIR" "$ARCHIVE_FOLDER/"
      rm -rf "$LOG_DIR"/*
    fi

    echo "   已归档到: $ARCHIVE_FOLDER"

    # 为新运行重置进度文件
    echo "# Botool 开发代理进度日志" > "$PROGRESS_FILE"
    echo "开始时间: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi

# ============================================================================
# 记录当前分支
# ============================================================================
if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(grep -o '"branchName": "[^"]*"' "$PRD_FILE" 2>/dev/null | sed 's/"branchName": "//;s/"$//' || echo "")
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

# ============================================================================
# 如果进度文件不存在则初始化
# ============================================================================
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Botool 开发代理进度日志" > "$PROGRESS_FILE"
  echo "开始时间: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

# ============================================================================
# 分支安全检查 - 防止丢失未合并的工作
# ============================================================================
check_branch_safety() {
  # 从prd.json读取目标分支
  local target_branch=$(grep -o '"branchName": "[^"]*"' "$PRD_FILE" 2>/dev/null | sed 's/"branchName": "//;s/"$//' || echo "")

  if [ -z "$target_branch" ]; then
    echo "⚠️  警告：prd.json 中没有指定 branchName"
    return 0
  fi

  # 获取当前git分支
  local current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  if [ -z "$current_branch" ]; then
    echo "⚠️  警告：无法获取当前git分支"
    return 0
  fi

  echo ">>> 分支检查："
  echo "    当前分支: $current_branch"
  echo "    目标分支: $target_branch"

  # 场景1：已经在目标分支 - 正常继续
  if [ "$current_branch" = "$target_branch" ]; then
    echo "    ✓ 已在目标分支，继续执行"
    return 0
  fi

  # 场景2：在main分支 - 检查目标分支是否已存在
  if [ "$current_branch" = "main" ] || [ "$current_branch" = "master" ]; then
    if git show-ref --verify --quiet "refs/heads/$target_branch" 2>/dev/null; then
      echo "    ✓ 目标分支已存在，将切换到该分支"
    else
      echo "    ✓ 将从main创建新分支: $target_branch"
    fi
    return 0
  fi

  # 场景3：在其他分支（非main非目标）- 需要检查是否有未合并的工作
  echo "    ⚠️  当前不在main也不在目标分支"

  # 检查当前分支是否有未合并到main的commits
  local unmerged_count=$(git log main..$current_branch --oneline 2>/dev/null | wc -l | tr -d ' ')

  if [ "$unmerged_count" -gt 0 ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║  ⛔ 停止！检测到未合并的工作                                      ║"
    echo "╠══════════════════════════════════════════════════════════════════╣"
    echo "║  当前分支 '$current_branch' 有 $unmerged_count 个commit未合并到main"
    echo "║                                                                  ║"
    echo "║  如果现在继续，BotoolAgent将从main创建新分支                     ║"
    echo "║  '$target_branch'，这会导致丢失当前分支的所有工作！              ║"
    echo "╠══════════════════════════════════════════════════════════════════╣"
    echo "║  请先执行以下操作：                                               ║"
    echo "║                                                                  ║"
    echo "║    1. git checkout main                                          ║"
    echo "║    2. git merge $current_branch                                  ║"
    echo "║    3. git push origin main  (可选但建议)                         ║"
    echo "║    4. 重新运行 ./BotoolAgent.sh                                  ║"
    echo "║                                                                  ║"
    echo "║  或者如果你确定不需要当前分支的工作：                             ║"
    echo "║    git checkout main && ./BotoolAgent.sh                         ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    exit 1
  else
    echo "    ✓ 当前分支没有未合并的工作，可以安全切换"
    return 0
  fi
}

# 执行分支安全检查
if [ -f "$PRD_FILE" ]; then
  check_branch_safety
fi

# ============================================================================
# 主循环
# ============================================================================
echo ""
echo "启动 Botool 开发代理 v2.0"
echo "  最大迭代次数: $MAX_ITERATIONS"
echo "  迭代超时时间: ${ITERATION_TIMEOUT}秒"
echo "  最大重试次数: $MAX_RETRIES"
if [ "$RATE_LIMIT_ENABLED" = "true" ]; then
  echo "  Rate Limiting: ${RATE_LIMIT_MAX_CALLS}次/${RATE_LIMIT_WINDOW}秒"
else
  echo "  Rate Limiting: 已禁用"
fi
echo ""

# 初始化 Rate Limiting
init_rate_limit

CURRENT_ITERATION=0

for i in $(seq 1 $MAX_ITERATIONS); do
  CURRENT_ITERATION=$i
  RETRY_COUNT=0

  echo ""
  echo "==============================================================="
  echo "  Botool 开发代理 - 第 $i 次迭代（共 $MAX_ITERATIONS 次）"
  echo "==============================================================="

  # 开始前检查 Rate Limiting
  check_rate_limit

  # 显示 Rate Limiting 状态
  show_rate_limit_status

  # 开始前检查网络
  wait_for_network

  # 本次迭代的重试循环
  iteration_success=false
  while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    update_status "running" "执行第 $i 次迭代（第 $((RETRY_COUNT + 1)) 次尝试）"

    # 为本次尝试创建日志文件
    LOG_FILE="$LOG_DIR/iteration-$i-attempt-$((RETRY_COUNT + 1))-$(date +%Y%m%d-%H%M%S).log"
    OUTPUT_FILE=$(mktemp)

    echo ">>> 启动 Claude（第 $((RETRY_COUNT + 1)) 次尝试，共 $MAX_RETRIES 次）..."
    echo ">>> 日志文件: $LOG_FILE"

    # 记录 API 调用（Rate Limiting）
    record_api_call

    # 运行带监控的 claude
    run_claude_with_monitoring "$OUTPUT_FILE" "$LOG_FILE"
    EXIT_CODE=$?

    # 复制输出到日志文件
    cp "$OUTPUT_FILE" "$LOG_FILE"

    # 处理不同的退出码
    if [ $EXIT_CODE -eq 124 ]; then
      echo ">>> 迭代超时，已运行 ${ITERATION_TIMEOUT} 秒"
      update_status "timeout" "第 $i 次迭代超时"
      ((RETRY_COUNT++))

      if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        echo ">>> 正在重试...（第 $RETRY_COUNT 次，共 $MAX_RETRIES 次）"
        # 重试前检查网络
        wait_for_network
        sleep 5
      fi
      rm -f "$OUTPUT_FILE"
      continue
    elif [ $EXIT_CODE -ne 0 ]; then
      echo ">>> Claude 退出，退出码: $EXIT_CODE"
      update_status "error" "Claude 退出，退出码 $EXIT_CODE"
      ((RETRY_COUNT++))

      if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        echo ">>> 正在重试...（第 $RETRY_COUNT 次，共 $MAX_RETRIES 次）"
        wait_for_network
        sleep 5
      fi
      rm -f "$OUTPUT_FILE"
      continue
    fi

    # 成功 - 显示输出并跳出重试循环
    cat "$OUTPUT_FILE"
    rm -f "$OUTPUT_FILE"
    iteration_success=true
    break
  done

  if [ "$iteration_success" = false ]; then
    echo ">>> 第 $i 次迭代的所有 $MAX_RETRIES 次重试都失败了"
    update_status "failed" "第 $i 次迭代的所有重试都失败"
    # 继续下一次迭代
  fi

  # 检查是否完成（验证 prd.json 中所有任务都通过）
  # 注意：grep -c 在计数为 0 时返回退出码 1，所以我们显式处理这种情况
  INCOMPLETE_TASKS=$(grep -c '"passes": false' "$PRD_FILE" 2>/dev/null) || INCOMPLETE_TASKS=0
  if [ "$INCOMPLETE_TASKS" = "0" ]; then
    echo ""
    echo "==============================================================="
    echo "  Botool 开发代理已完成所有任务！"
    echo "  在第 $i 次迭代完成（共 $MAX_ITERATIONS 次）"
    echo "==============================================================="
    update_status "complete" "所有任务已完成"
    exit 0
  fi

  # 每次迭代后报告进度
  COMPLETED=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null || echo "?")
  TOTAL=$(grep -c '"id": "DT-' "$PRD_FILE" 2>/dev/null || echo "?")
  LAST_TASK=$(grep -o '## [0-9-]* - DT-[0-9]*' "$PROGRESS_FILE" 2>/dev/null | tail -1 | grep -o 'DT-[0-9]*' || echo "?")
  echo ""
  echo ">>> 进度: $COMPLETED/$TOTAL 个任务已完成（最后完成: $LAST_TASK）"
  echo ">>> $(date '+%H:%M:%S')"
  echo ""

  update_status "iteration_complete" "第 $i 次迭代完成，$COMPLETED/$TOTAL 个任务已完成"

  echo "第 $i 次迭代完成。继续下一次..."
  sleep 2
done

echo ""
echo "Botool 开发代理已达到最大迭代次数（$MAX_ITERATIONS），但未完成所有任务。"
echo "请查看 $PROGRESS_FILE 了解状态。"
update_status "max_iterations" "已达到最大迭代次数，但未完成所有任务"
exit 1
