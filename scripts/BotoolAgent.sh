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
NETWORK_MONITOR_PID=""

cleanup() {
  echo ""
  echo ">>> 收到退出信号，正在清理..."
  if [ -n "$NETWORK_MONITOR_PID" ] && kill -0 "$NETWORK_MONITOR_PID" 2>/dev/null; then
    echo ">>> 终止网络监控进程 (PID: $NETWORK_MONITOR_PID)"
    kill "$NETWORK_MONITOR_PID" 2>/dev/null
    wait "$NETWORK_MONITOR_PID" 2>/dev/null
  fi
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

# Circuit Breaker 配置
CIRCUIT_BREAKER_ENABLED=true        # 是否启用 Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=3         # 连续无进展迭代次数阈值
CIRCUIT_BREAKER_STATE_FILE=""       # Circuit Breaker 状态文件（启动时设置）

# 运行时网络健康检查配置
NETWORK_HEALTH_CHECK_ENABLED=true   # 是否启用运行时网络检查
NETWORK_HEALTH_CHECK_INTERVAL=60    # 检查间隔（秒）
NETWORK_NO_ACTIVITY_THRESHOLD=300   # 无网络活动阈值（秒），超过则重启

# Hooks 配置
HOOK_PRE_ITERATION=""      # 每次迭代开始前执行的脚本
HOOK_POST_ITERATION=""     # 每次迭代完成后执行的脚本
HOOK_ON_COMPLETE=""        # 所有任务完成时执行的脚本
HOOK_ON_ERROR=""           # 发生错误时执行的脚本

# 通知配置
NOTIFICATION_ENABLED=false  # 是否启用系统通知
NOTIFICATION_SOUND=true     # 通知时是否播放声音

# Claude 模型配置
CLAUDE_MODEL=""              # Claude 模型 (opus/sonnet/haiku/opusplan)
CLAUDE_EFFORT=""             # 努力级别 (low/medium/high)
CLAUDE_SUBAGENT_MODEL=""     # 子代理模型
RATE_LIMIT_STRATEGY="personal"  # 限额策略 (team: 60s重试 / personal: 5h等待)

# ============================================================================
# 加载 .botoolrc 配置文件（如果存在）
# ============================================================================
load_config() {
  local config_file="$SCRIPT_DIR/.botoolrc"

  if [ -f "$config_file" ]; then
    echo ">>> 加载配置文件: $config_file"
    # shellcheck source=/dev/null
    source "$config_file"
  else
    echo ">>> 配置文件不存在，使用默认值"
    echo "    提示: 复制 docs/examples/botoolrc.example 为 .botoolrc 可自定义配置"
  fi

  # 环境变量覆盖配置文件（优先级最高）
  # 基础配置
  [ -n "$BOTOOL_MAX_ITERATIONS" ] && MAX_ITERATIONS="$BOTOOL_MAX_ITERATIONS"
  [ -n "$BOTOOL_TIMEOUT" ] && ITERATION_TIMEOUT="$BOTOOL_TIMEOUT"
  [ -n "$BOTOOL_RETRIES" ] && MAX_RETRIES="$BOTOOL_RETRIES"
  [ -n "$BOTOOL_HEALTH_CHECK_INTERVAL" ] && HEALTH_CHECK_INTERVAL="$BOTOOL_HEALTH_CHECK_INTERVAL"
  [ -n "$BOTOOL_STALL_THRESHOLD" ] && STALL_THRESHOLD="$BOTOOL_STALL_THRESHOLD"
  [ -n "$BOTOOL_NETWORK_RETRY_INTERVAL" ] && NETWORK_RETRY_INTERVAL="$BOTOOL_NETWORK_RETRY_INTERVAL"

  # Rate Limiting 配置
  [ -n "$BOTOOL_RATE_LIMIT_ENABLED" ] && RATE_LIMIT_ENABLED="$BOTOOL_RATE_LIMIT_ENABLED"
  [ -n "$BOTOOL_RATE_LIMIT_MAX_CALLS" ] && RATE_LIMIT_MAX_CALLS="$BOTOOL_RATE_LIMIT_MAX_CALLS"
  [ -n "$BOTOOL_RATE_LIMIT_WINDOW" ] && RATE_LIMIT_WINDOW="$BOTOOL_RATE_LIMIT_WINDOW"

  # Circuit Breaker 配置
  [ -n "$BOTOOL_CIRCUIT_BREAKER_ENABLED" ] && CIRCUIT_BREAKER_ENABLED="$BOTOOL_CIRCUIT_BREAKER_ENABLED"
  [ -n "$BOTOOL_CIRCUIT_BREAKER_THRESHOLD" ] && CIRCUIT_BREAKER_THRESHOLD="$BOTOOL_CIRCUIT_BREAKER_THRESHOLD"

  # 网络健康检查配置
  [ -n "$BOTOOL_NETWORK_HEALTH_CHECK_ENABLED" ] && NETWORK_HEALTH_CHECK_ENABLED="$BOTOOL_NETWORK_HEALTH_CHECK_ENABLED"
  [ -n "$BOTOOL_NETWORK_HEALTH_CHECK_INTERVAL" ] && NETWORK_HEALTH_CHECK_INTERVAL="$BOTOOL_NETWORK_HEALTH_CHECK_INTERVAL"
  [ -n "$BOTOOL_NETWORK_NO_ACTIVITY_THRESHOLD" ] && NETWORK_NO_ACTIVITY_THRESHOLD="$BOTOOL_NETWORK_NO_ACTIVITY_THRESHOLD"

  # Hooks 配置
  [ -n "$BOTOOL_HOOK_PRE_ITERATION" ] && HOOK_PRE_ITERATION="$BOTOOL_HOOK_PRE_ITERATION"
  [ -n "$BOTOOL_HOOK_POST_ITERATION" ] && HOOK_POST_ITERATION="$BOTOOL_HOOK_POST_ITERATION"
  [ -n "$BOTOOL_HOOK_ON_COMPLETE" ] && HOOK_ON_COMPLETE="$BOTOOL_HOOK_ON_COMPLETE"
  [ -n "$BOTOOL_HOOK_ON_ERROR" ] && HOOK_ON_ERROR="$BOTOOL_HOOK_ON_ERROR"

  # 通知配置
  [ -n "$BOTOOL_NOTIFICATION_ENABLED" ] && NOTIFICATION_ENABLED="$BOTOOL_NOTIFICATION_ENABLED"
  [ -n "$BOTOOL_NOTIFICATION_SOUND" ] && NOTIFICATION_SOUND="$BOTOOL_NOTIFICATION_SOUND"

  # Claude 模型配置
  [ -n "$BOTOOL_CLAUDE_MODEL" ] && CLAUDE_MODEL="$BOTOOL_CLAUDE_MODEL"
  [ -n "$BOTOOL_CLAUDE_EFFORT" ] && CLAUDE_EFFORT="$BOTOOL_CLAUDE_EFFORT"
  [ -n "$BOTOOL_CLAUDE_SUBAGENT_MODEL" ] && CLAUDE_SUBAGENT_MODEL="$BOTOOL_CLAUDE_SUBAGENT_MODEL"
  [ -n "$BOTOOL_RATE_LIMIT_STRATEGY" ] && RATE_LIMIT_STRATEGY="$BOTOOL_RATE_LIMIT_STRATEGY"
}

# ============================================================================
# 解析参数
# ============================================================================
PROJECT_DIR=""  # 用户项目目录（可移植模式）

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
    --project-dir)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --prd-path)
      PRD_PATH_OVERRIDE="$2"
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
# Normalize to BotoolAgent root when running from scripts/ subdirectory
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
  SCRIPT_DIR="$(dirname "$SCRIPT_DIR")"
fi

# 自动检测项目目录（可移植模式支持）
# 优先级: --project-dir 参数 > 环境变量 > 自动检测
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR="${BOTOOL_PROJECT_ROOT:-}"
fi
if [ -z "$PROJECT_DIR" ]; then
  # 自动检测: 如果 SCRIPT_DIR 有 .git，它就是项目根目录（独立模式）
  # 否则，检查父目录是否有 .git（可移植模式）
  if [ -d "$SCRIPT_DIR/.git" ]; then
    PROJECT_DIR="$SCRIPT_DIR"
  elif [ -d "$(dirname "$SCRIPT_DIR")/.git" ]; then
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
  else
    PROJECT_DIR="$SCRIPT_DIR"
  fi
fi

# BotoolAgent 自身的文件路径（始终在 SCRIPT_DIR）
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"
LOG_DIR="$SCRIPT_DIR/logs"
STATUS_FILE="$SCRIPT_DIR/.agent-status"
RATE_LIMIT_STATE_FILE="$SCRIPT_DIR/.rate-limit-state"
CIRCUIT_BREAKER_STATE_FILE="$SCRIPT_DIR/.circuit-breaker-state"

# 用户项目的文件路径（在 PROJECT_DIR）
# --prd-path 覆盖：支持多 PRD 模式，progress 文件自动从 prd 路径推导
if [ -n "$PRD_PATH_OVERRIDE" ]; then
  PRD_FILE="$PRD_PATH_OVERRIDE"
  # 推导 progress 文件：prd-xxx.json → progress-xxx.txt
  PRD_BASENAME="$(basename "$PRD_PATH_OVERRIDE")"
  PROGRESS_BASENAME="${PRD_BASENAME/prd-/progress-}"
  PROGRESS_BASENAME="${PROGRESS_BASENAME/.json/.txt}"
  PROGRESS_FILE="$(dirname "$PRD_PATH_OVERRIDE")/$PROGRESS_BASENAME"
else
  PRD_FILE="$PROJECT_DIR/prd.json"
  PROGRESS_FILE="$PROJECT_DIR/progress.txt"
fi

if [ "$PROJECT_DIR" != "$SCRIPT_DIR" ]; then
  echo ">>> 可移植模式: 项目目录 = $PROJECT_DIR"
  echo ">>> BotoolAgent 目录 = $SCRIPT_DIR"
fi

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

  # Circuit Breaker 状态
  local cb_no_progress_count=0
  local cb_last_completed=0
  if [ "$CIRCUIT_BREAKER_ENABLED" = "true" ] && [ -f "$CIRCUIT_BREAKER_STATE_FILE" ]; then
    cb_no_progress_count=$(grep -o '"noProgressCount": [0-9]*' "$CIRCUIT_BREAKER_STATE_FILE" 2>/dev/null | grep -o '[0-9]*' || echo "0")
    cb_last_completed=$(grep -o '"lastCompletedCount": [0-9]*' "$CIRCUIT_BREAKER_STATE_FILE" 2>/dev/null | grep -o '[0-9]*' || echo "0")
  fi

  # 双条件验证状态（使用全局变量，如果已设置）
  local dual_check_promise="${DUAL_CHECK_PROMISE:-false}"
  local dual_check_tasks="${DUAL_CHECK_TASKS:-false}"

  # API Rate Limit 状态（使用全局变量，如果已设置）
  local api_rate_limit_until="${API_RATE_LIMIT_UNTIL:-0}"
  local api_rate_limit_remaining="${API_RATE_LIMIT_REMAINING:-0}"

  # 响应分析状态（使用全局变量，如果已设置）
  local resp_has_code_changes="${RESPONSE_HAS_CODE_CHANGES:-false}"
  local resp_has_git_commit="${RESPONSE_HAS_GIT_COMMIT:-false}"
  local resp_has_file_edits="${RESPONSE_HAS_FILE_EDITS:-false}"
  local resp_has_tool_calls="${RESPONSE_HAS_TOOL_CALLS:-false}"
  local resp_confidence="${RESPONSE_CONFIDENCE:-unknown}"
  local resp_warnings="${RESPONSE_WARNING_FLAGS:-}"

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
  },
  "circuitBreaker": {
    "enabled": $( [ "$CIRCUIT_BREAKER_ENABLED" = "true" ] && echo "true" || echo "false" ),
    "noProgressCount": $cb_no_progress_count,
    "threshold": $CIRCUIT_BREAKER_THRESHOLD,
    "lastCompletedCount": $cb_last_completed
  },
  "dualExitCheck": {
    "promiseDetected": $( [ "$dual_check_promise" = "true" ] && echo "true" || echo "false" ),
    "allTasksComplete": $( [ "$dual_check_tasks" = "true" ] && echo "true" || echo "false" )
  },
  "apiRateLimit": {
    "waiting": $( [ "$api_rate_limit_remaining" -gt 0 ] && echo "true" || echo "false" ),
    "resetAt": $api_rate_limit_until,
    "remainingSeconds": $api_rate_limit_remaining
  },
  "responseAnalysis": {
    "hasCodeChanges": $( [ "$resp_has_code_changes" = "true" ] && echo "true" || echo "false" ),
    "hasGitCommit": $( [ "$resp_has_git_commit" = "true" ] && echo "true" || echo "false" ),
    "hasFileEdits": $( [ "$resp_has_file_edits" = "true" ] && echo "true" || echo "false" ),
    "hasToolCalls": $( [ "$resp_has_tool_calls" = "true" ] && echo "true" || echo "false" ),
    "confidence": "$resp_confidence",
    "warnings": "$resp_warnings"
  },
  "model": "${CLAUDE_MODEL:-default}",
  "effort": "${CLAUDE_EFFORT:-default}",
  "rateLimitStrategy": "$RATE_LIMIT_STRATEGY"
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
# Hooks 功能 - 在关键节点执行自定义脚本
# ============================================================================

# 执行 Hook 脚本
# 参数:
#   $1 - hook 类型 (pre_iteration, post_iteration, on_complete, on_error)
#   $2 - hook 脚本路径
#   $3+ - 传递给 hook 的额外参数
# 返回: 0 = 执行成功或无需执行, 1 = 执行失败（但不影响主流程）
# 注意: Hook 执行失败不会影响主流程
execute_hook() {
  local hook_type="$1"
  local hook_script="$2"
  shift 2
  local hook_args=("$@")

  # 如果没有配置 hook，直接返回
  if [ -z "$hook_script" ]; then
    return 0
  fi

  # 解析相对路径（相对于 SCRIPT_DIR）
  if [[ "$hook_script" != /* ]]; then
    hook_script="$SCRIPT_DIR/$hook_script"
  fi

  # 检查脚本是否存在
  if [ ! -f "$hook_script" ]; then
    echo ">>> [Hooks] 警告: $hook_type hook 脚本不存在: $hook_script"
    return 0  # 脚本不存在不视为错误，只是警告
  fi

  # 检查脚本是否可执行
  if [ ! -x "$hook_script" ]; then
    echo ">>> [Hooks] 警告: $hook_type hook 脚本不可执行: $hook_script"
    echo ">>> [Hooks] 提示: 运行 chmod +x $hook_script 使其可执行"
    return 0
  fi

  echo ">>> [Hooks] 执行 $hook_type hook: $hook_script"

  # 设置 hook 环境变量
  local hook_env=(
    "BOTOOL_HOOK_TYPE=$hook_type"
    "BOTOOL_ITERATION=$CURRENT_ITERATION"
    "BOTOOL_MAX_ITERATIONS=$MAX_ITERATIONS"
    "BOTOOL_PRD_FILE=$PRD_FILE"
    "BOTOOL_PROGRESS_FILE=$PROGRESS_FILE"
    "BOTOOL_LOG_DIR=$LOG_DIR"
    "BOTOOL_STATUS_FILE=$STATUS_FILE"
  )

  # 添加完成任务数（如果 PRD 文件存在）
  if [ -f "$PRD_FILE" ]; then
    local completed=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null || echo "0")
    local total=$(grep -c '"id": "DT-' "$PRD_FILE" 2>/dev/null || echo "0")
    hook_env+=("BOTOOL_COMPLETED_TASKS=$completed")
    hook_env+=("BOTOOL_TOTAL_TASKS=$total")
  fi

  # 执行 hook（带超时保护，最多 60 秒）
  local hook_output
  local hook_exit_code

  # 使用 timeout 执行 hook，防止 hook 阻塞主流程
  if command -v gtimeout &> /dev/null; then
    hook_output=$(env "${hook_env[@]}" gtimeout 60 "$hook_script" "${hook_args[@]}" 2>&1)
    hook_exit_code=$?
  elif command -v timeout &> /dev/null; then
    hook_output=$(env "${hook_env[@]}" timeout 60 "$hook_script" "${hook_args[@]}" 2>&1)
    hook_exit_code=$?
  else
    # 没有 timeout 命令，直接执行
    hook_output=$(env "${hook_env[@]}" "$hook_script" "${hook_args[@]}" 2>&1)
    hook_exit_code=$?
  fi

  # 处理 hook 执行结果
  if [ $hook_exit_code -eq 0 ]; then
    echo ">>> [Hooks] $hook_type hook 执行成功"
    if [ -n "$hook_output" ]; then
      echo ">>> [Hooks] 输出:"
      echo "$hook_output" | sed 's/^/    /'
    fi
    return 0
  elif [ $hook_exit_code -eq 124 ]; then
    echo ">>> [Hooks] ⚠️ $hook_type hook 执行超时（60秒）"
    return 1
  else
    echo ">>> [Hooks] ⚠️ $hook_type hook 执行失败（退出码: $hook_exit_code）"
    if [ -n "$hook_output" ]; then
      echo ">>> [Hooks] 错误输出:"
      echo "$hook_output" | sed 's/^/    /'
    fi
    return 1
  fi
}

# 执行 preIteration hook
# 在每次迭代开始前调用
run_pre_iteration_hook() {
  execute_hook "preIteration" "$HOOK_PRE_ITERATION" "$CURRENT_ITERATION"
}

# 执行 postIteration hook
# 在每次迭代完成后调用
# 参数: $1 - 迭代是否成功 (true/false)
run_post_iteration_hook() {
  local success="$1"
  execute_hook "postIteration" "$HOOK_POST_ITERATION" "$CURRENT_ITERATION" "$success"
}

# 执行 onComplete hook
# 在所有任务完成时调用
run_on_complete_hook() {
  execute_hook "onComplete" "$HOOK_ON_COMPLETE"
}

# 执行 onError hook
# 在发生错误时调用
# 参数: $1 - 错误类型, $2 - 错误消息
run_on_error_hook() {
  local error_type="$1"
  local error_message="$2"
  execute_hook "onError" "$HOOK_ON_ERROR" "$error_type" "$error_message"
}

# 显示 Hooks 配置状态
show_hooks_config() {
  local has_hooks=false

  if [ -n "$HOOK_PRE_ITERATION" ]; then
    echo "  preIteration Hook: $HOOK_PRE_ITERATION"
    has_hooks=true
  fi
  if [ -n "$HOOK_POST_ITERATION" ]; then
    echo "  postIteration Hook: $HOOK_POST_ITERATION"
    has_hooks=true
  fi
  if [ -n "$HOOK_ON_COMPLETE" ]; then
    echo "  onComplete Hook: $HOOK_ON_COMPLETE"
    has_hooks=true
  fi
  if [ -n "$HOOK_ON_ERROR" ]; then
    echo "  onError Hook: $HOOK_ON_ERROR"
    has_hooks=true
  fi

  if [ "$has_hooks" = "false" ]; then
    echo "  Hooks: 未配置"
  fi
}

# ============================================================================
# 系统通知功能 - macOS 系统通知
# ============================================================================

# 获取项目名称（从 prd.json）
get_project_name() {
  if [ -f "$PRD_FILE" ]; then
    local name=$(grep -o '"project": "[^"]*"' "$PRD_FILE" 2>/dev/null | sed 's/"project": "//;s/"$//')
    if [ -n "$name" ]; then
      echo "$name"
      return
    fi
  fi
  echo "BotoolAgent"
}

# 发送 macOS 系统通知
# 参数:
#   $1 - 通知标题
#   $2 - 通知内容
#   $3 - 通知类型 (success/error/warning/info)
send_notification() {
  local title="$1"
  local message="$2"
  local type="${3:-info}"

  # 检查是否启用通知
  if [ "$NOTIFICATION_ENABLED" != "true" ]; then
    return 0
  fi

  # 只在 macOS 上支持
  if [ "$(uname)" != "Darwin" ]; then
    echo ">>> [通知] 系统通知仅支持 macOS"
    return 0
  fi

  # 构建 AppleScript 命令
  local sound_option=""
  if [ "$NOTIFICATION_SOUND" = "true" ]; then
    # 根据类型选择不同的声音
    case "$type" in
      success)
        sound_option='sound name "Glass"'
        ;;
      error)
        sound_option='sound name "Basso"'
        ;;
      warning)
        sound_option='sound name "Sosumi"'
        ;;
      *)
        sound_option='sound name "Pop"'
        ;;
    esac
  fi

  # 执行 AppleScript 发送通知
  osascript -e "display notification \"$message\" with title \"$title\" $sound_option" 2>/dev/null

  if [ $? -eq 0 ]; then
    echo ">>> [通知] 已发送系统通知: $title"
  else
    echo ">>> [通知] 发送通知失败"
  fi
}

# 发送完成通知
# 在所有任务完成时调用
send_complete_notification() {
  local project_name=$(get_project_name)
  local completed=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null || echo "0")

  send_notification \
    "✅ $project_name 完成" \
    "所有 $completed 个任务已完成！" \
    "success"
}

# 发送错误通知
# 参数:
#   $1 - 错误类型
#   $2 - 错误消息
send_error_notification() {
  local error_type="$1"
  local error_message="$2"
  local project_name=$(get_project_name)

  local title=""
  local message=""

  case "$error_type" in
    iteration_failed)
      title="⛔ $project_name 已停止"
      message="迭代重试次数已用尽，脚本已停止。请检查问题后手动重启。"
      ;;
    circuit_breaker)
      title="⛔ $project_name 停止"
      message="连续多次迭代无进展，自动停止"
      ;;
    max_iterations)
      title="⏰ $project_name 超限"
      message="已达到最大迭代次数，未完成所有任务"
      ;;
    *)
      title="❌ $project_name 错误"
      message="${error_message:-发生未知错误}"
      ;;
  esac

  send_notification "$title" "$message" "error"
}

# 显示通知配置状态
show_notification_config() {
  if [ "$NOTIFICATION_ENABLED" = "true" ]; then
    echo "  系统通知: 已启用"
    if [ "$NOTIFICATION_SOUND" = "true" ]; then
      echo "  通知声音: 已启用"
    else
      echo "  通知声音: 已禁用"
    fi
  else
    echo "  系统通知: 已禁用"
  fi
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

# ============================================================================
# Circuit Breaker 功能 - 连续无进展时自动停止
# ============================================================================

# 初始化 Circuit Breaker 状态
init_circuit_breaker() {
  if [ "$CIRCUIT_BREAKER_ENABLED" != "true" ]; then
    return 0
  fi

  # 获取当前完成的任务数
  local current_completed=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null) || current_completed=0

  # 如果状态文件不存在，创建初始状态
  if [ ! -f "$CIRCUIT_BREAKER_STATE_FILE" ]; then
    cat > "$CIRCUIT_BREAKER_STATE_FILE" << EOF
{
  "lastCompletedCount": $current_completed,
  "noProgressCount": 0,
  "lastCheckIteration": 0
}
EOF
    echo ">>> Circuit Breaker 已初始化: 连续 $CIRCUIT_BREAKER_THRESHOLD 次无进展将停止"
  fi
}

# 读取 Circuit Breaker 状态
read_circuit_breaker_state() {
  if [ ! -f "$CIRCUIT_BREAKER_STATE_FILE" ]; then
    init_circuit_breaker
  fi

  CB_LAST_COMPLETED=$(grep -o '"lastCompletedCount": [0-9]*' "$CIRCUIT_BREAKER_STATE_FILE" | grep -o '[0-9]*')
  CB_NO_PROGRESS_COUNT=$(grep -o '"noProgressCount": [0-9]*' "$CIRCUIT_BREAKER_STATE_FILE" | grep -o '[0-9]*')
  CB_LAST_CHECK_ITERATION=$(grep -o '"lastCheckIteration": [0-9]*' "$CIRCUIT_BREAKER_STATE_FILE" | grep -o '[0-9]*')
}

# 更新 Circuit Breaker 状态
update_circuit_breaker_state() {
  local last_completed=$1
  local no_progress_count=$2
  local last_check_iteration=$3

  cat > "$CIRCUIT_BREAKER_STATE_FILE" << EOF
{
  "lastCompletedCount": $last_completed,
  "noProgressCount": $no_progress_count,
  "lastCheckIteration": $last_check_iteration
}
EOF
}

# 显示 Circuit Breaker 状态
show_circuit_breaker_status() {
  if [ "$CIRCUIT_BREAKER_ENABLED" != "true" ]; then
    return 0
  fi

  read_circuit_breaker_state

  echo ">>> Circuit Breaker 状态:"
  echo "    上次记录完成数: $CB_LAST_COMPLETED"
  echo "    连续无进展次数: $CB_NO_PROGRESS_COUNT/$CIRCUIT_BREAKER_THRESHOLD"
}

# 检查 Circuit Breaker - 每次迭代后调用
# 返回 0 表示可以继续，返回 1 表示应该停止
check_circuit_breaker() {
  if [ "$CIRCUIT_BREAKER_ENABLED" != "true" ]; then
    return 0
  fi

  read_circuit_breaker_state

  # 获取当前完成的任务数
  local current_completed=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null) || current_completed=0

  echo ">>> Circuit Breaker 检查: 完成任务数 $CB_LAST_COMPLETED -> $current_completed"

  if [ "$current_completed" -gt "$CB_LAST_COMPLETED" ]; then
    # 有进展，重置计数器
    echo ">>> ✓ 有进展（新增 $((current_completed - CB_LAST_COMPLETED)) 个任务完成），重置 Circuit Breaker"
    update_circuit_breaker_state $current_completed 0 $CURRENT_ITERATION
    return 0
  else
    # 无进展，增加计数
    CB_NO_PROGRESS_COUNT=$((CB_NO_PROGRESS_COUNT + 1))
    update_circuit_breaker_state $current_completed $CB_NO_PROGRESS_COUNT $CURRENT_ITERATION

    echo ">>> ⚠️  无进展（连续 $CB_NO_PROGRESS_COUNT 次）"

    if [ "$CB_NO_PROGRESS_COUNT" -ge "$CIRCUIT_BREAKER_THRESHOLD" ]; then
      echo ""
      echo "╔══════════════════════════════════════════════════════════════════╗"
      echo "║  ⛔ Circuit Breaker 触发 - 停止执行                              ║"
      echo "╠══════════════════════════════════════════════════════════════════╣"
      echo "║  连续 $CB_NO_PROGRESS_COUNT 次迭代没有完成新的任务                             "
      echo "║  这可能表示：                                                    ║"
      echo "║    - 代理遇到了无法自动解决的问题                               ║"
      echo "║    - 任务需求不明确或超出代理能力                               ║"
      echo "║    - 需要人工介入检查                                           ║"
      echo "╠══════════════════════════════════════════════════════════════════╣"
      echo "║  建议操作：                                                      ║"
      echo "║    1. 检查 progress.txt 和日志了解详情                          ║"
      echo "║    2. 检查 prd.json 中待完成的任务                              ║"
      echo "║    3. 手动解决问题后重新运行                                    ║"
      echo "╚══════════════════════════════════════════════════════════════════╝"
      echo ""
      return 1
    fi

    return 0
  fi
}

# ============================================================================
# Anthropic API Rate Limit 处理（5小时限制）
# ============================================================================

# 全局变量用于 API rate limit 状态
API_RATE_LIMIT_UNTIL=0
API_RATE_LIMIT_REMAINING=0

# 检测 Claude 输出是否包含 API rate limit 错误
# 参数: $1 - 输出文件路径
# 返回: 0 = 检测到限制, 1 = 未检测到
# 设置全局变量: API_RATE_LIMIT_UNTIL（解除时间戳）
check_api_rate_limit() {
  local output_file="$1"

  if [ ! -f "$output_file" ]; then
    return 1
  fi

  # 检测常见的 rate limit 错误消息
  # Anthropic API 返回的错误格式示例:
  # - "rate_limit_error" / "rate limit exceeded"
  # - "You've exceeded your current usage limit"
  # - "Request was throttled"
  # - "Too many requests"
  # - 包含 "retry after" 或 "try again in" 的消息

  local rate_limit_detected=false
  local retry_seconds=0

  # 检查各种 rate limit 错误模式
  if grep -qi "rate.limit\|rate_limit\|usage.limit\|too.many.requests\|throttled" "$output_file" 2>/dev/null; then
    rate_limit_detected=true

    # 尝试提取重试时间
    # 模式1: "retry after X seconds" 或 "try again in X seconds"
    local retry_match=$(grep -oiE "(retry|try).*(after|in)[^0-9]*([0-9]+)" "$output_file" 2>/dev/null | grep -oE "[0-9]+" | head -1)
    if [ -n "$retry_match" ]; then
      retry_seconds=$retry_match
    fi

    # 模式2: "X seconds" 或 "X minutes" 或 "X hours" 紧跟在 rate limit 消息后
    if [ "$retry_seconds" -eq 0 ]; then
      local time_match=$(grep -oiE "[0-9]+\s*(second|minute|hour)" "$output_file" 2>/dev/null | head -1)
      if [ -n "$time_match" ]; then
        local value=$(echo "$time_match" | grep -oE "[0-9]+")
        local unit=$(echo "$time_match" | grep -oiE "(second|minute|hour)")
        case "$unit" in
          second|Second|SECOND)
            retry_seconds=$value
            ;;
          minute|Minute|MINUTE)
            retry_seconds=$((value * 60))
            ;;
          hour|Hour|HOUR)
            retry_seconds=$((value * 3600))
            ;;
        esac
      fi
    fi

    # 模式3: 检测 Anthropic 特定的 5 小时限制消息
    if grep -qi "5.hour\|five.hour" "$output_file" 2>/dev/null; then
      retry_seconds=$((5 * 3600))  # 5 小时 = 18000 秒
    fi

    # 如果没有检测到具体时间，使用默认值（30 分钟）
    if [ "$retry_seconds" -eq 0 ]; then
      retry_seconds=1800  # 默认 30 分钟
      echo ">>> [API Rate Limit] 无法解析具体等待时间，使用默认值 30 分钟"
    fi
  fi

  if [ "$rate_limit_detected" = "true" ]; then
    local now=$(date +%s)
    API_RATE_LIMIT_UNTIL=$((now + retry_seconds))
    API_RATE_LIMIT_REMAINING=$retry_seconds
    return 0
  fi

  return 1
}

# 格式化时间显示
format_duration() {
  local seconds=$1
  local hours=$((seconds / 3600))
  local minutes=$(((seconds % 3600) / 60))
  local secs=$((seconds % 60))

  if [ $hours -gt 0 ]; then
    printf "%d小时%02d分%02d秒" $hours $minutes $secs
  elif [ $minutes -gt 0 ]; then
    printf "%d分%02d秒" $minutes $secs
  else
    printf "%d秒" $secs
  fi
}

# 等待 API rate limit 解除
# 参数: $1 - 等待秒数
wait_for_api_rate_limit() {
  local wait_seconds=$1

  if [ "$wait_seconds" -le 0 ]; then
    return 0
  fi

  echo ""
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  ⏳ Anthropic API Rate Limit - 等待限制解除                      ║"
  echo "╠══════════════════════════════════════════════════════════════════╣"
  echo "║  检测到 API 调用频率限制（可能是 5 小时限制）                   ║"
  echo "║  预计等待时间: $(format_duration $wait_seconds)                                         "
  echo "║  解除时间: $(date -r $API_RATE_LIMIT_UNTIL '+%Y-%m-%d %H:%M:%S')                        "
  echo "╠══════════════════════════════════════════════════════════════════╣"
  echo "║  脚本将自动等待并在限制解除后继续...                            ║"
  echo "║  按 Ctrl+C 可中断等待                                            ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  echo ""

  # 更新状态为 waiting_rate_limit
  update_status "waiting_rate_limit" "API 限制等待中，预计 $(format_duration $wait_seconds) 后继续"

  local remaining=$wait_seconds
  local update_interval=60  # 每分钟更新一次状态

  while [ $remaining -gt 0 ]; do
    # 显示倒计时
    printf "\r>>> 等待中... $(format_duration $remaining)          "

    # 计算本次睡眠时间（最多 60 秒）
    local sleep_time=$update_interval
    if [ $remaining -lt $update_interval ]; then
      sleep_time=$remaining
    fi

    sleep $sleep_time
    remaining=$((remaining - sleep_time))

    # 更新全局状态变量
    API_RATE_LIMIT_REMAINING=$remaining

    # 每分钟更新状态文件
    if [ $((remaining % 60)) -eq 0 ] && [ $remaining -gt 0 ]; then
      update_status "waiting_rate_limit" "API 限制等待中，剩余 $(format_duration $remaining)"
    fi
  done

  echo ""
  echo ">>> API Rate Limit 等待完成，继续执行..."

  # 重置状态
  API_RATE_LIMIT_UNTIL=0
  API_RATE_LIMIT_REMAINING=0

  return 0
}

# 处理 API rate limit（检测并等待）
# 参数: $1 - 输出文件路径
# 返回: 0 = 已处理（等待完成或无限制）, 1 = 应该重试
handle_api_rate_limit() {
  local output_file="$1"

  if check_api_rate_limit "$output_file"; then
    echo ""
    echo ">>> [API Rate Limit] 检测到 API 限制错误"
    echo ">>> [API Rate Limit] 需要等待 $(format_duration $API_RATE_LIMIT_REMAINING)"

    # 等待限制解除
    wait_for_api_rate_limit $API_RATE_LIMIT_REMAINING

    return 1  # 返回 1 表示应该重试
  fi

  return 0  # 无限制
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

# ============================================================================
# 运行时进程健康检查（改进版：检测输出文件增长而非网络活动）
# ============================================================================

# 检查进程是否有活动（输出文件是否增长）
check_process_activity() {
  local pid=$1
  local output_file=$2
  local last_size=$3

  # 如果进程不存在，返回失败
  if ! kill -0 $pid 2>/dev/null; then
    return 1
  fi

  # 获取当前输出文件大小
  local current_size=0
  if [ -f "$output_file" ]; then
    current_size=$(stat -f%z "$output_file" 2>/dev/null || stat -c%s "$output_file" 2>/dev/null || echo "0")
  fi

  # 如果文件大小增长了，说明有活动
  if [ "$current_size" -gt "$last_size" ]; then
    return 0  # 有活动
  fi

  # 也检查 CPU 是否 > 0（进程在思考）
  local cpu=$(ps -p $pid -o %cpu= 2>/dev/null | tr -d ' ' | cut -d. -f1)
  if [ -n "$cpu" ] && [ "$cpu" -gt 0 ]; then
    return 0  # 有 CPU 活动
  fi

  return 1  # 无活动
}

# 后台进程健康监控（改进版）
# 如果进程长时间没有任何活动（输出文件不增长 + CPU 为 0），返回 1
NETWORK_MONITOR_PID=""

monitor_network_health() {
  local pid=$1
  local output_file="${2:-}"
  local no_activity_count=0
  local checks_needed=$((NETWORK_NO_ACTIVITY_THRESHOLD / NETWORK_HEALTH_CHECK_INTERVAL))
  local last_file_size=0

  # 获取初始文件大小
  if [ -n "$output_file" ] && [ -f "$output_file" ]; then
    last_file_size=$(stat -f%z "$output_file" 2>/dev/null || stat -c%s "$output_file" 2>/dev/null || echo "0")
  fi

  while kill -0 $pid 2>/dev/null; do
    sleep $NETWORK_HEALTH_CHECK_INTERVAL

    # 获取当前文件大小
    local current_size=0
    if [ -n "$output_file" ] && [ -f "$output_file" ]; then
      current_size=$(stat -f%z "$output_file" 2>/dev/null || stat -c%s "$output_file" 2>/dev/null || echo "0")
    fi

    if check_process_activity $pid "$output_file" "$last_file_size"; then
      # 有活动，重置计数
      no_activity_count=0
      last_file_size=$current_size
    else
      # 没有活动
      ((no_activity_count++))
      local elapsed=$((no_activity_count * NETWORK_HEALTH_CHECK_INTERVAL))
      echo ">>> [健康检查] Claude PID $pid 无活动 (${elapsed}秒) - 文件大小: ${current_size} bytes"

      if [ $no_activity_count -ge $checks_needed ]; then
        echo ">>> [健康检查] ⚠️  超过 ${NETWORK_NO_ACTIVITY_THRESHOLD}秒 无活动（文件不增长 + CPU 为 0），终止进程"
        kill -9 $pid 2>/dev/null
        return 1
      fi
    fi
  done

  return 0
}

# 运行 claude 并带有超时（简化版，更可靠）
run_claude_with_monitoring() {
  local output_file=$1
  local log_file=$2

  # 查找 claude 命令的完整路径
  local CLAUDE_CMD=$(which claude 2>/dev/null || echo "$HOME/.claude/local/claude")

  # 构建 claude 命令参数
  local CLAUDE_ARGS="--dangerously-skip-permissions --print"
  if [ -n "$CLAUDE_MODEL" ]; then
    CLAUDE_ARGS="$CLAUDE_ARGS --model $CLAUDE_MODEL"
    echo ">>> 使用模型: $CLAUDE_MODEL"
  fi

  # 设置 Claude 环境变量
  if [ -n "$CLAUDE_EFFORT" ]; then
    export CLAUDE_CODE_EFFORT_LEVEL="$CLAUDE_EFFORT"
    echo ">>> 努力级别: $CLAUDE_EFFORT"
  fi
  if [ -n "$CLAUDE_SUBAGENT_MODEL" ]; then
    export CLAUDE_CODE_SUBAGENT_MODEL="$CLAUDE_SUBAGENT_MODEL"
    echo ">>> 子代理模型: $CLAUDE_SUBAGENT_MODEL"
  fi

  # 确保 Claude 在用户项目目录中运行
  cd "$PROJECT_DIR"

  # 检查 timeout 命令是否可用
  if command -v gtimeout &> /dev/null; then
    # macOS with coreutils - 后台运行并记录 PID
    gtimeout $ITERATION_TIMEOUT "$CLAUDE_CMD" $CLAUDE_ARGS < "$SCRIPT_DIR/CLAUDE.md" > "$output_file" 2>&1 &
    CLAUDE_PID=$!
    wait $CLAUDE_PID
  elif command -v timeout &> /dev/null; then
    # Linux or macOS with timeout
    timeout $ITERATION_TIMEOUT "$CLAUDE_CMD" $CLAUDE_ARGS < "$SCRIPT_DIR/CLAUDE.md" > "$output_file" 2>&1 &
    CLAUDE_PID=$!
    wait $CLAUDE_PID
  else
    # 没有 timeout 命令，使用网络健康检查作为备用保护
    echo ">>> 警告：未找到 timeout 命令（建议安装: brew install coreutils）"
    "$CLAUDE_CMD" $CLAUDE_ARGS < "$SCRIPT_DIR/CLAUDE.md" > "$output_file" 2>&1 &
    CLAUDE_PID=$!
    echo ">>> Claude PID: $CLAUDE_PID"

    # 启动进程健康监控（如果启用）
    if [ "$NETWORK_HEALTH_CHECK_ENABLED" = "true" ]; then
      echo ">>> 启动进程健康监控（${NETWORK_NO_ACTIVITY_THRESHOLD}秒无活动将重启）"
      monitor_network_health $CLAUDE_PID "$output_file" &
      NETWORK_MONITOR_PID=$!
    fi

    wait $CLAUDE_PID
  fi
  local exit_code=$?

  # 停止网络监控（如果在运行）
  if [ -n "$NETWORK_MONITOR_PID" ] && kill -0 "$NETWORK_MONITOR_PID" 2>/dev/null; then
    kill "$NETWORK_MONITOR_PID" 2>/dev/null
    wait "$NETWORK_MONITOR_PID" 2>/dev/null
  fi
  NETWORK_MONITOR_PID=""

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
# 如果 patterns.json 不存在则初始化
# ============================================================================
PATTERNS_FILE="$PROJECT_DIR/patterns.json"
if [ ! -f "$PATTERNS_FILE" ]; then
  cat > "$PATTERNS_FILE" << 'PATTERNS_EOF'
{
  "version": "1.0",
  "maxEntries": 30,
  "lastUpdated": "",
  "patterns": []
}
PATTERNS_EOF
  echo ">>> patterns.json 已初始化"
fi

# ============================================================================
# 如果 .project-status 不存在则初始化
# ============================================================================
PROJECT_STATUS_FILE="$PROJECT_DIR/.project-status"
if [ ! -f "$PROJECT_STATUS_FILE" ]; then
  cat > "$PROJECT_STATUS_FILE" << 'EOF'
{
  "currentBranch": "",
  "lastCompleted": [],
  "inProgress": "",
  "updatedAt": ""
}
EOF
  log "INFO" "Created empty .project-status"
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
# Eval Execution - 运行 prd.json 中定义的验证命令
# ============================================================================
run_evals() {
  local TASK_ID="$1"

  if [ ! -f "$PRD_FILE" ]; then
    echo ">>> [Eval] 没有找到 prd.json，跳过 eval 执行"
    return 0
  fi

  # Check if jq is available
  if ! command -v jq &> /dev/null; then
    echo ">>> [Eval] 警告：jq 未安装，跳过 eval 执行"
    return 0
  fi

  # Extract evals for the current task
  local EVALS
  EVALS=$(jq -r ".devTasks[]? | select(.id == \"$TASK_ID\") | .evals // [] | .[] | select(.type == \"code-based\") | @base64" "$PRD_FILE" 2>/dev/null)

  if [ -z "$EVALS" ]; then
    echo ">>> [Eval] 任务 $TASK_ID 没有 code-based eval"
    return 0
  fi

  local EVAL_PASS=0
  local EVAL_FAIL=0
  local BLOCKING_FAIL=0

  while IFS= read -r eval_b64; do
    [ -z "$eval_b64" ] && continue

    local EVAL_DESC
    EVAL_DESC=$(echo "$eval_b64" | base64 -d | jq -r '.description')
    local EVAL_CMD
    EVAL_CMD=$(echo "$eval_b64" | base64 -d | jq -r '.command')
    local EVAL_EXPECT
    EVAL_EXPECT=$(echo "$eval_b64" | base64 -d | jq -r '.expect')
    local EVAL_BLOCKING
    EVAL_BLOCKING=$(echo "$eval_b64" | base64 -d | jq -r '.blocking')

    echo ">>> [Eval] 运行: $EVAL_DESC"
    echo ">>> [Eval]   命令: $EVAL_CMD"

    # Run the command
    local OUTPUT
    OUTPUT=$(eval "$EVAL_CMD" 2>&1)
    local EXIT_CODE=$?

    # Check expectation
    local PASSED=false
    case "$EVAL_EXPECT" in
      exit-0)
        [ $EXIT_CODE -eq 0 ] && PASSED=true
        ;;
      exit-non-0)
        [ $EXIT_CODE -ne 0 ] && PASSED=true
        ;;
      contains:*)
        local EXPECTED="${EVAL_EXPECT#contains:}"
        echo "$OUTPUT" | grep -q "$EXPECTED" && PASSED=true
        ;;
      not-contains:*)
        local EXPECTED="${EVAL_EXPECT#not-contains:}"
        ! echo "$OUTPUT" | grep -q "$EXPECTED" && PASSED=true
        ;;
    esac

    if [ "$PASSED" = true ]; then
      echo ">>> [Eval]   PASSED: $EVAL_DESC"
      ((EVAL_PASS++))
    else
      if [ "$EVAL_BLOCKING" = "true" ]; then
        echo ">>> [Eval]   FAILED (blocking): $EVAL_DESC"
        ((EVAL_FAIL++))
        ((BLOCKING_FAIL++))
      else
        echo ">>> [Eval]   FAILED (non-blocking): $EVAL_DESC"
        ((EVAL_FAIL++))
      fi
    fi
  done <<< "$EVALS"

  echo ">>> [Eval] 结果: $EVAL_PASS 通过, $EVAL_FAIL 失败 ($BLOCKING_FAIL 个 blocking)"

  if [ "$BLOCKING_FAIL" -gt 0 ]; then
    echo ">>> [Eval] 有 $BLOCKING_FAIL 个 blocking eval 失败"
    return 1
  fi

  return 0
}

# ============================================================================
# 响应分析器 - 语义分析 Claude 输出判断任务完成
# ============================================================================

# 响应分析结果 - 全局变量
RESPONSE_ANALYSIS_LOG=""
RESPONSE_HAS_CODE_CHANGES="false"
RESPONSE_HAS_GIT_COMMIT="false"
RESPONSE_HAS_FILE_EDITS="false"
RESPONSE_HAS_TOOL_CALLS="false"
RESPONSE_CONFIDENCE="low"  # low, medium, high
RESPONSE_WARNING_FLAGS=""

# 记录分析结果到日志
log_analysis() {
  local message="$1"
  local timestamp=$(date '+%H:%M:%S')
  RESPONSE_ANALYSIS_LOG="${RESPONSE_ANALYSIS_LOG}[$timestamp] $message\n"
}

# 检测是否有实际的代码修改（通过工具调用）
# 参数: $1 - 输出文件路径
# 返回: 0 = 检测到修改, 1 = 未检测到
detect_code_changes() {
  local output_file="$1"

  if [ ! -f "$output_file" ]; then
    log_analysis "无法读取输出文件"
    return 1
  fi

  local changes_detected=false

  # 检测 Edit 工具调用（实际编辑文件）
  # Claude CLI 输出格式: 会包含 "Edit" 或 "edited" 等关键词
  if grep -qiE '(Edit|edited|Editing|修改了|编辑了).*\.(ts|js|tsx|jsx|py|sh|json|md|css|html)' "$output_file" 2>/dev/null; then
    log_analysis "检测到文件编辑操作"
    RESPONSE_HAS_FILE_EDITS="true"
    changes_detected=true
  fi

  # 检测 Write 工具调用（创建新文件）
  if grep -qiE '(Write|wrote|Writing|created|Creating|创建了|写入了).*\.(ts|js|tsx|jsx|py|sh|json|md|css|html)' "$output_file" 2>/dev/null; then
    log_analysis "检测到文件创建操作"
    RESPONSE_HAS_FILE_EDITS="true"
    changes_detected=true
  fi

  # 检测工具调用的 JSON 格式（stream-json 输出）
  if grep -qE '"type":\s*"tool_use"' "$output_file" 2>/dev/null; then
    log_analysis "检测到工具调用 (JSON 格式)"
    RESPONSE_HAS_TOOL_CALLS="true"
    changes_detected=true
  fi

  # 检测 Bash 工具调用（可能包含代码操作）
  if grep -qiE '(Bash|执行命令|运行命令|bash command)' "$output_file" 2>/dev/null; then
    log_analysis "检测到 Bash 工具调用"
    RESPONSE_HAS_TOOL_CALLS="true"
    changes_detected=true
  fi

  if [ "$changes_detected" = "true" ]; then
    RESPONSE_HAS_CODE_CHANGES="true"
    return 0
  fi

  log_analysis "未检测到代码修改操作"
  return 1
}

# 检测是否有 git commit
# 参数: $1 - 输出文件路径
# 返回: 0 = 检测到 commit, 1 = 未检测到
detect_git_commit() {
  local output_file="$1"

  if [ ! -f "$output_file" ]; then
    return 1
  fi

  # 检测 git commit 相关输出
  # 常见模式：
  # - "git commit -m" 命令
  # - "committed" 关键词
  # - "Created commit" 消息
  # - commit hash 格式 [xxx abc1234]

  if grep -qiE 'git\s+commit\s+-m' "$output_file" 2>/dev/null; then
    log_analysis "检测到 git commit 命令"
    RESPONSE_HAS_GIT_COMMIT="true"
    return 0
  fi

  if grep -qiE '(committed|提交了|已提交|commit.*created|created.*commit)' "$output_file" 2>/dev/null; then
    log_analysis "检测到 commit 确认消息"
    RESPONSE_HAS_GIT_COMMIT="true"
    return 0
  fi

  # 检测 commit hash 格式 (例如: [main abc1234] 或 abc1234)
  if grep -qE '\[[a-z/-]+\s+[a-f0-9]{7,}\]' "$output_file" 2>/dev/null; then
    log_analysis "检测到 commit hash"
    RESPONSE_HAS_GIT_COMMIT="true"
    return 0
  fi

  log_analysis "未检测到 git commit"
  return 1
}

# 检测可能的误判信号 - 意图但未行动
# 参数: $1 - 输出文件路径
# 返回: 警告标志字符串
detect_false_positive_signals() {
  local output_file="$1"
  local warnings=""

  if [ ! -f "$output_file" ]; then
    return
  fi

  # 检测"将要做"但可能没做的模式
  # 中文模式
  if grep -qE '(我将|我会|我要|让我|接下来我|下一步我).*(修改|编辑|创建|添加|实现)' "$output_file" 2>/dev/null; then
    # 检查是否实际执行了（查找后续的工具调用或结果）
    local line_count=$(wc -l < "$output_file" | tr -d ' ')
    local intent_line=$(grep -nE '(我将|我会|我要|让我|接下来我|下一步我).*(修改|编辑|创建|添加|实现)' "$output_file" 2>/dev/null | head -1 | cut -d: -f1)

    if [ -n "$intent_line" ] && [ "$line_count" -lt $((intent_line + 20)) ]; then
      warnings="${warnings}INTENT_WITHOUT_ACTION;"
      log_analysis "⚠️ 警告: 检测到意图表达但输出过短，可能未实际执行"
    fi
  fi

  # 英文模式
  if grep -qiE "(I will|I'm going to|Let me|I'll).*(edit|modify|create|add|implement)" "$output_file" 2>/dev/null; then
    local line_count=$(wc -l < "$output_file" | tr -d ' ')
    local intent_line=$(grep -niE "(I will|I'm going to|Let me|I'll).*(edit|modify|create|add|implement)" "$output_file" 2>/dev/null | head -1 | cut -d: -f1)

    if [ -n "$intent_line" ] && [ "$line_count" -lt $((intent_line + 20)) ]; then
      warnings="${warnings}INTENT_WITHOUT_ACTION_EN;"
      log_analysis "⚠️ Warning: Intent expression detected but output too short"
    fi
  fi

  # 检测错误或中断信号
  if grep -qiE '(error|failed|失败|错误|异常|Exception|无法|cannot|could not)' "$output_file" 2>/dev/null; then
    warnings="${warnings}ERROR_DETECTED;"
    log_analysis "⚠️ 警告: 检测到错误或失败信息"
  fi

  # 检测超时或中断
  if grep -qiE '(timeout|timed out|超时|中断|interrupted)' "$output_file" 2>/dev/null; then
    warnings="${warnings}TIMEOUT_DETECTED;"
    log_analysis "⚠️ 警告: 检测到超时或中断"
  fi

  # 检测"无法完成"或"需要帮助"的信号
  if grep -qiE '(无法完成|cannot complete|need help|需要帮助|stuck|卡住|blocked)' "$output_file" 2>/dev/null; then
    warnings="${warnings}BLOCKED_DETECTED;"
    log_analysis "⚠️ 警告: 检测到任务阻塞信号"
  fi

  RESPONSE_WARNING_FLAGS="$warnings"
}

# 计算置信度
# 基于检测到的信号综合判断
calculate_confidence() {
  local confidence_score=0

  # 正面信号加分
  [ "$RESPONSE_HAS_CODE_CHANGES" = "true" ] && confidence_score=$((confidence_score + 30))
  [ "$RESPONSE_HAS_GIT_COMMIT" = "true" ] && confidence_score=$((confidence_score + 40))
  [ "$RESPONSE_HAS_FILE_EDITS" = "true" ] && confidence_score=$((confidence_score + 20))
  [ "$RESPONSE_HAS_TOOL_CALLS" = "true" ] && confidence_score=$((confidence_score + 10))

  # 警告信号减分
  if echo "$RESPONSE_WARNING_FLAGS" | grep -q "INTENT_WITHOUT_ACTION"; then
    confidence_score=$((confidence_score - 30))
  fi
  if echo "$RESPONSE_WARNING_FLAGS" | grep -q "ERROR_DETECTED"; then
    confidence_score=$((confidence_score - 20))
  fi
  if echo "$RESPONSE_WARNING_FLAGS" | grep -q "TIMEOUT_DETECTED"; then
    confidence_score=$((confidence_score - 25))
  fi
  if echo "$RESPONSE_WARNING_FLAGS" | grep -q "BLOCKED_DETECTED"; then
    confidence_score=$((confidence_score - 35))
  fi

  # 确定置信度等级
  if [ $confidence_score -ge 60 ]; then
    RESPONSE_CONFIDENCE="high"
  elif [ $confidence_score -ge 30 ]; then
    RESPONSE_CONFIDENCE="medium"
  else
    RESPONSE_CONFIDENCE="low"
  fi

  log_analysis "置信度得分: $confidence_score -> $RESPONSE_CONFIDENCE"
}

# 主分析函数 - 综合分析 Claude 输出
# 参数: $1 - 输出文件路径
# 返回: 0 = 分析完成
analyze_response() {
  local output_file="$1"
  local log_file="$2"

  # 重置分析状态
  RESPONSE_ANALYSIS_LOG=""
  RESPONSE_HAS_CODE_CHANGES="false"
  RESPONSE_HAS_GIT_COMMIT="false"
  RESPONSE_HAS_FILE_EDITS="false"
  RESPONSE_HAS_TOOL_CALLS="false"
  RESPONSE_CONFIDENCE="low"
  RESPONSE_WARNING_FLAGS=""

  log_analysis "========== 响应分析开始 =========="

  if [ ! -f "$output_file" ]; then
    log_analysis "错误: 输出文件不存在"
    echo ">>> [响应分析器] 无法分析 - 输出文件不存在"
    return 1
  fi

  local file_size=$(stat -f%z "$output_file" 2>/dev/null || echo "0")
  local line_count=$(wc -l < "$output_file" 2>/dev/null | tr -d ' ' || echo "0")
  log_analysis "输出文件大小: $file_size bytes, 行数: $line_count"

  # 执行各项检测
  detect_code_changes "$output_file"
  detect_git_commit "$output_file"
  detect_false_positive_signals "$output_file"

  # 计算置信度
  calculate_confidence

  log_analysis "========== 响应分析结束 =========="

  # 输出分析结果
  echo ""
  echo ">>> [响应分析器] 分析结果:"
  echo "    代码修改: $([ "$RESPONSE_HAS_CODE_CHANGES" = "true" ] && echo "✓ 是" || echo "✗ 否")"
  echo "    Git Commit: $([ "$RESPONSE_HAS_GIT_COMMIT" = "true" ] && echo "✓ 是" || echo "✗ 否")"
  echo "    文件编辑: $([ "$RESPONSE_HAS_FILE_EDITS" = "true" ] && echo "✓ 是" || echo "✗ 否")"
  echo "    工具调用: $([ "$RESPONSE_HAS_TOOL_CALLS" = "true" ] && echo "✓ 是" || echo "✗ 否")"
  echo "    置信度: $RESPONSE_CONFIDENCE"

  if [ -n "$RESPONSE_WARNING_FLAGS" ]; then
    echo "    ⚠️  警告标志: $RESPONSE_WARNING_FLAGS"
  fi

  # 如果提供了日志文件，将分析日志追加到其中
  if [ -n "$log_file" ] && [ -f "$log_file" ]; then
    echo "" >> "$log_file"
    echo "========== 响应分析日志 ==========" >> "$log_file"
    echo -e "$RESPONSE_ANALYSIS_LOG" >> "$log_file"
    log_analysis "分析日志已追加到: $log_file"
  fi

  return 0
}

# 显示分析摘要（用于状态更新）
get_analysis_summary() {
  local summary=""

  if [ "$RESPONSE_HAS_GIT_COMMIT" = "true" ]; then
    summary="有 commit"
  elif [ "$RESPONSE_HAS_CODE_CHANGES" = "true" ]; then
    summary="有代码修改"
  elif [ "$RESPONSE_HAS_TOOL_CALLS" = "true" ]; then
    summary="有工具调用"
  else
    summary="无明显操作"
  fi

  if [ -n "$RESPONSE_WARNING_FLAGS" ]; then
    summary="$summary (有警告)"
  fi

  echo "$summary [$RESPONSE_CONFIDENCE]"
}

# ============================================================================
# 双条件退出验证 - 检测 <promise>COMPLETE</promise> 和 prd.json 状态
# ============================================================================

# 检测 Claude 输出中是否包含 COMPLETE 承诺
# 参数: $1 - 输出文件路径
# 返回: 0 = 检测到承诺, 1 = 未检测到
check_complete_promise() {
  local output_file="$1"

  if [ ! -f "$output_file" ]; then
    return 1
  fi

  # 检测 <promise>COMPLETE</promise> 标签
  if grep -q '<promise>COMPLETE</promise>' "$output_file" 2>/dev/null; then
    return 0
  fi

  return 1
}

# 检查 prd.json 中是否所有任务都完成
# 返回: 0 = 全部完成, 1 = 有未完成任务
check_all_tasks_complete() {
  local incomplete_count=$(grep -c '"passes": false' "$PRD_FILE" 2>/dev/null) || incomplete_count=0

  if [ "$incomplete_count" = "0" ]; then
    return 0
  fi

  return 1
}

# 执行双条件退出验证
# 参数: $1 - 输出文件路径
# 返回: 0 = 应该退出（两个条件都满足）, 1 = 不应该退出
# 设置全局变量:
#   - DUAL_CHECK_PROMISE: 是否检测到 COMPLETE 承诺 (true/false)
#   - DUAL_CHECK_TASKS: 是否所有任务完成 (true/false)
verify_dual_exit_conditions() {
  local output_file="$1"

  DUAL_CHECK_PROMISE="false"
  DUAL_CHECK_TASKS="false"

  # 检查 COMPLETE 承诺
  if check_complete_promise "$output_file"; then
    DUAL_CHECK_PROMISE="true"
    echo ">>> [双条件验证] ✓ 检测到 <promise>COMPLETE</promise>"
  else
    echo ">>> [双条件验证] ✗ 未检测到 <promise>COMPLETE</promise>"
  fi

  # 检查任务完成状态
  if check_all_tasks_complete; then
    DUAL_CHECK_TASKS="true"
    local completed=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null || echo "0")
    echo ">>> [双条件验证] ✓ prd.json 中所有 $completed 个任务已完成"
  else
    local incomplete=$(grep -c '"passes": false' "$PRD_FILE" 2>/dev/null || echo "?")
    echo ">>> [双条件验证] ✗ prd.json 中还有 $incomplete 个未完成任务"
  fi

  # 双条件验证结果
  if [ "$DUAL_CHECK_PROMISE" = "true" ] && [ "$DUAL_CHECK_TASKS" = "true" ]; then
    echo ">>> [双条件验证] ✓✓ 两个条件都满足，可以安全退出"
    return 0
  fi

  # 只满足一个条件的警告
  if [ "$DUAL_CHECK_PROMISE" = "true" ] && [ "$DUAL_CHECK_TASKS" = "false" ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║  ⚠️  警告：条件不一致                                            ║"
    echo "╠══════════════════════════════════════════════════════════════════╣"
    echo "║  Claude 声称任务已完成（输出 COMPLETE 承诺）                    ║"
    echo "║  但 prd.json 中还有未完成的任务                                 ║"
    echo "║                                                                  ║"
    echo "║  可能原因：                                                      ║"
    echo "║    - Claude 忘记更新 prd.json 中的 passes 字段                  ║"
    echo "║    - Claude 对任务完成的判断有误                                ║"
    echo "║                                                                  ║"
    echo "║  继续下一次迭代尝试修正...                                      ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
  fi

  if [ "$DUAL_CHECK_PROMISE" = "false" ] && [ "$DUAL_CHECK_TASKS" = "true" ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║  ⚠️  警告：条件不一致                                            ║"
    echo "╠══════════════════════════════════════════════════════════════════╣"
    echo "║  prd.json 中所有任务已标记为完成                                ║"
    echo "║  但 Claude 没有输出 COMPLETE 承诺                               ║"
    echo "║                                                                  ║"
    echo "║  可能原因：                                                      ║"
    echo "║    - 任务是在之前的迭代中完成的                                 ║"
    echo "║    - Claude 可能还有后续工作要做                                ║"
    echo "║    - Claude 忘记输出 COMPLETE 标记                              ║"
    echo "║                                                                  ║"
    echo "║  由于所有任务都已完成，将退出循环                               ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    # 所有任务都完成时，即使没有 COMPLETE 承诺也退出
    return 0
  fi

  return 1
}

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
if [ "$CIRCUIT_BREAKER_ENABLED" = "true" ]; then
  echo "  Circuit Breaker: 连续${CIRCUIT_BREAKER_THRESHOLD}次无进展将停止"
else
  echo "  Circuit Breaker: 已禁用"
fi
if [ "$NETWORK_HEALTH_CHECK_ENABLED" = "true" ]; then
  echo "  网络健康检查: ${NETWORK_NO_ACTIVITY_THRESHOLD}秒无活动将重启"
else
  echo "  网络健康检查: 已禁用"
fi
show_hooks_config
show_notification_config
echo ""

# 初始化 Rate Limiting
init_rate_limit

# 初始化 Circuit Breaker
init_circuit_breaker

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

  # 执行 preIteration hook
  run_pre_iteration_hook

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

      # 检查是否是 API rate limit 错误
      if handle_api_rate_limit "$OUTPUT_FILE"; then
        # 不是 rate limit 错误，按正常错误处理
        update_status "error" "Claude 退出，退出码 $EXIT_CODE"
        ((RETRY_COUNT++))

        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
          echo ">>> 正在重试...（第 $RETRY_COUNT 次，共 $MAX_RETRIES 次）"
          wait_for_network
          sleep 5
        fi
        rm -f "$OUTPUT_FILE"
        continue
      else
        # 是 rate limit 错误，已经等待完成，重试但不增加计数
        echo ">>> API Rate Limit 等待完成，重试当前迭代..."
        rm -f "$OUTPUT_FILE"
        # 重新检查网络
        wait_for_network
        continue
      fi
    fi

    # 成功退出，但仍需检查输出中是否包含 rate limit 错误
    # （有时 API 限制错误会在部分输出后发生）
    if ! handle_api_rate_limit "$OUTPUT_FILE"; then
      # 检测到 rate limit 错误并已等待完成，重试
      echo ">>> 输出中检测到 API Rate Limit 错误，等待后重试..."
      rm -f "$OUTPUT_FILE"
      wait_for_network
      continue
    fi

    # 真正成功 - 显示输出
    cat "$OUTPUT_FILE"
    # 保存输出文件路径用于双条件验证（稍后删除）
    LAST_OUTPUT_FILE="$OUTPUT_FILE"
    iteration_success=true
    break
  done

  if [ "$iteration_success" = false ]; then
    echo ">>> 第 $i 次迭代的所有 $MAX_RETRIES 次重试都失败了"
    echo ">>> ⛔ 由于任务可能有依赖关系，停止脚本以避免级联失败"
    update_status "failed" "第 $i 次迭代的所有重试都失败，脚本已停止"
    LAST_OUTPUT_FILE=""
    # 执行 onError hook
    run_on_error_hook "iteration_failed" "第 $i 次迭代的所有 $MAX_RETRIES 次重试都失败"
    # 发送错误通知
    send_error_notification "iteration_failed" "第 $i 次迭代的所有 $MAX_RETRIES 次重试都失败，脚本已停止"
    # 执行 postIteration hook（失败情况）
    run_post_iteration_hook "false"
    # 停止脚本，而不是继续下一次迭代（因为任务可能有依赖关系）
    echo ""
    echo ">>> 请检查问题后手动重启: ./BotoolAgent.sh $((MAX_ITERATIONS - i + 1))"
    exit 1
  else
    # 迭代成功，执行响应分析
    echo ""
    echo ">>> 执行响应分析..."
    analyze_response "$LAST_OUTPUT_FILE" "$LOG_FILE"
    ANALYSIS_SUMMARY=$(get_analysis_summary)
    echo ">>> 分析摘要: $ANALYSIS_SUMMARY"
  fi

  # 检查是否完成 - 使用双条件验证
  echo ""
  echo ">>> 执行双条件退出验证..."

  if verify_dual_exit_conditions "$LAST_OUTPUT_FILE"; then
    # 清理临时文件
    [ -n "$LAST_OUTPUT_FILE" ] && rm -f "$LAST_OUTPUT_FILE"

    # 执行 postIteration hook（成功情况）
    run_post_iteration_hook "true"

    # 执行 onComplete hook
    run_on_complete_hook

    # 发送完成通知
    send_complete_notification

    echo ""
    echo "==============================================================="
    if [ "$DUAL_CHECK_PROMISE" = "true" ] && [ "$DUAL_CHECK_TASKS" = "true" ]; then
      echo "  ✓✓ Botool 开发代理已完成所有任务！"
      echo "  双条件验证通过：COMPLETE 承诺 + 任务状态"
    else
      echo "  ✓ Botool 开发代理已完成所有任务！"
      echo "  单条件通过：所有任务已标记完成"
    fi
    echo "  在第 $i 次迭代完成（共 $MAX_ITERATIONS 次）"
    echo "==============================================================="
    update_status "complete" "所有任务已完成"
    exit 0
  fi

  # 清理临时文件
  [ -n "$LAST_OUTPUT_FILE" ] && rm -f "$LAST_OUTPUT_FILE"
  LAST_OUTPUT_FILE=""

  # 每次迭代后报告进度
  COMPLETED=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null || echo "?")
  TOTAL=$(grep -c '"id": "DT-' "$PRD_FILE" 2>/dev/null || echo "?")
  LAST_TASK=$(grep -o '## [0-9-]* - DT-[0-9]*' "$PROGRESS_FILE" 2>/dev/null | tail -1 | grep -o 'DT-[0-9]*' || echo "?")
  echo ""
  echo ">>> 进度: $COMPLETED/$TOTAL 个任务已完成（最后完成: $LAST_TASK）"
  echo ">>> $(date '+%H:%M:%S')"
  echo ""

  update_status "iteration_complete" "第 $i 次迭代完成，$COMPLETED/$TOTAL 个任务已完成"

  # Update .project-status (will be further enriched by Agent via CLAUDE.md instructions)
  if [ -f "$PROJECT_STATUS_FILE" ]; then
    log "INFO" ".project-status will be updated by Agent"
  fi

  # 检查 Circuit Breaker（只在迭代成功时检查）
  if [ "$iteration_success" = true ]; then
    # 执行 postIteration hook（成功但未完成所有任务）
    run_post_iteration_hook "true"

    if ! check_circuit_breaker; then
      # 执行 onError hook（Circuit Breaker 触发）
      run_on_error_hook "circuit_breaker" "连续 $CIRCUIT_BREAKER_THRESHOLD 次迭代无进展"
      # 发送错误通知
      send_error_notification "circuit_breaker" "连续 $CIRCUIT_BREAKER_THRESHOLD 次迭代无进展"
      update_status "circuit_breaker" "Circuit Breaker 触发 - 连续无进展停止"
      exit 1
    fi
  fi

  echo "第 $i 次迭代完成。继续下一次..."
  sleep 2
done

echo ""
echo "Botool 开发代理已达到最大迭代次数（$MAX_ITERATIONS），但未完成所有任务。"
echo "请查看 $PROGRESS_FILE 了解状态。"

# 执行 onError hook（达到最大迭代次数）
run_on_error_hook "max_iterations" "已达到最大迭代次数 $MAX_ITERATIONS，但未完成所有任务"

# 发送错误通知
send_error_notification "max_iterations" "已达到最大迭代次数 $MAX_ITERATIONS，但未完成所有任务"

update_status "max_iterations" "已达到最大迭代次数，但未完成所有任务"
exit 1
