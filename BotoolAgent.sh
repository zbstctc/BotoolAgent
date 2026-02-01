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

set -e

# ============================================================================
# 配置
# ============================================================================
MAX_ITERATIONS=10
ITERATION_TIMEOUT=1800  # 每次迭代 30 分钟
MAX_RETRIES=3           # 每次迭代的重试次数
HEALTH_CHECK_INTERVAL=10  # 健康检查间隔（秒）
STALL_THRESHOLD=30      # 连续 0% CPU 检查次数阈值（5 分钟）
NETWORK_RETRY_INTERVAL=30  # 网络检查重试间隔（秒）

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

# 创建日志目录
mkdir -p "$LOG_DIR"

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
  "retryCount": ${RETRY_COUNT:-0}
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

# 运行 claude 并带有超时和健康监控
run_claude_with_monitoring() {
  local output_file=$1
  local log_file=$2

  # 在后台启动带超时的 claude
  timeout $ITERATION_TIMEOUT claude --dangerously-skip-permissions --print < "$SCRIPT_DIR/CLAUDE.md" > "$output_file" 2>&1 &
  local claude_pid=$!

  # 在后台启动健康监控
  monitor_health $claude_pid "$output_file" &
  local monitor_pid=$!

  # 等待 claude 完成
  wait $claude_pid 2>/dev/null
  local exit_code=$?

  # 停止健康监控
  kill $monitor_pid 2>/dev/null || true
  wait $monitor_pid 2>/dev/null || true

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
# 主循环
# ============================================================================
echo "启动 Botool 开发代理 v2.0"
echo "  最大迭代次数: $MAX_ITERATIONS"
echo "  迭代超时时间: ${ITERATION_TIMEOUT}秒"
echo "  最大重试次数: $MAX_RETRIES"
echo ""

CURRENT_ITERATION=0

for i in $(seq 1 $MAX_ITERATIONS); do
  CURRENT_ITERATION=$i
  RETRY_COUNT=0

  echo ""
  echo "==============================================================="
  echo "  Botool 开发代理 - 第 $i 次迭代（共 $MAX_ITERATIONS 次）"
  echo "==============================================================="

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
