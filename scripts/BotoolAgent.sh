#!/bin/bash
# BotoolAgent - 自主开发代理 (tmux + Agent Teams)
# 用法: ./BotoolAgent.sh [--project-dir <path>]
#
# 使用 Claude Code 的 Agent Teams 功能，通过 tmux 启动交互式会话。
# Lead Agent 负责编排多个 DT 任务的并行执行。

# ============================================================================
# 默认配置
# ============================================================================
SESSION_NAME="botool-teams"
BOTOOL_TEAMMATE_MODE="${BOTOOL_TEAMMATE_MODE:-in-process}"
BOTOOL_MODEL="${BOTOOL_MODEL:-claude-opus-4-6}"  # Lead Agent 模型（默认 Opus）
MAX_ROUNDS=20             # Ralph 外循环最大轮次
ROUND_COOLDOWN=10         # 轮次间冷却（秒）
STALL_TIMEOUT=900         # 卡住检测超时（秒，默认 15 分钟）

# ============================================================================
# Signal handler: cleanup tmux session
# ============================================================================
cleanup() {
  echo ""
  echo ">>> 收到退出信号，正在清理..."
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo ">>> 终止 tmux session: $SESSION_NAME"
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null
  fi
  rm -f "$PID_FILE"
  update_status "stopped" "用户停止或脚本退出"
  echo ">>> 清理完成"
  exit 0
}

trap cleanup SIGINT SIGTERM

# ============================================================================
# 解析参数
# ============================================================================
PROJECT_DIR=""
PROJECT_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --project-dir)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --prd-path)
      PRD_PATH_OVERRIDE="$2"
      shift 2
      ;;
    --project-id)
      PROJECT_ID="$2"
      shift 2
      ;;
    *)
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

# 自动检测项目目录
# 优先级: --project-dir 参数 > 环境变量 > 调用者 CWD（有 .git）> SCRIPT_DIR
CALLER_CWD="$(pwd)"
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR="${BOTOOL_PROJECT_ROOT:-}"
fi
if [ -z "$PROJECT_DIR" ]; then
  # 优先使用调用者的 CWD（如果它是一个 git 仓库且不是 BotoolAgent 自身）
  if [ -d "$CALLER_CWD/.git" ] && [ "$CALLER_CWD" != "$SCRIPT_DIR" ]; then
    PROJECT_DIR="$CALLER_CWD"
  elif [ -d "$SCRIPT_DIR/.git" ]; then
    PROJECT_DIR="$SCRIPT_DIR"
  elif [ -d "$(dirname "$SCRIPT_DIR")/.git" ]; then
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
  else
    PROJECT_DIR="$SCRIPT_DIR"
  fi
fi

ARCHIVE_DIR="$SCRIPT_DIR/tasks/snapshots"

# --prd-path 覆盖：支持多 PRD 模式
if [ -n "$PRD_PATH_OVERRIDE" ]; then
  PRD_FILE="$PRD_PATH_OVERRIDE"
  PRD_BASENAME="$(basename "$PRD_PATH_OVERRIDE")"
  if [ "$PRD_BASENAME" = "dev.json" ] || [ "$PRD_BASENAME" = "prd.json" ]; then
    # New format: tasks/{id}/dev.json → progress at tasks/{id}/progress.txt
    PROGRESS_FILE="$(dirname "$PRD_PATH_OVERRIDE")/progress.txt"
    # Auto-extract PROJECT_ID from parent directory name if not provided
    if [ -z "$PROJECT_ID" ]; then
      PROJECT_ID="$(basename "$(dirname "$PRD_PATH_OVERRIDE")")"
    fi
  else
    # Legacy format: tasks/prd-{id}.json → progress at tasks/progress-{id}.txt
    PROGRESS_BASENAME="${PRD_BASENAME/prd-/progress-}"
    PROGRESS_BASENAME="${PROGRESS_BASENAME/.json/.txt}"
    PROGRESS_FILE="$(dirname "$PRD_PATH_OVERRIDE")/$PROGRESS_BASENAME"
    # Auto-extract PROJECT_ID from filename prefix if not provided
    if [ -z "$PROJECT_ID" ]; then
      PROJECT_ID="${PRD_BASENAME#prd-}"
      PROJECT_ID="${PROJECT_ID%.json}"
    fi
  fi
else
  # Prefer dev.json; fall back to prd.json for backward compatibility
  if [ -f "$PROJECT_DIR/dev.json" ]; then
    PRD_FILE="$PROJECT_DIR/dev.json"
  else
    PRD_FILE="$PROJECT_DIR/prd.json"
  fi
  PROGRESS_FILE="$PROJECT_DIR/progress.txt"
fi

# Configure session name and per-project status/pid files
if [ -n "$PROJECT_ID" ]; then
  SESSION_NAME="botool-teams-${PROJECT_ID}"
  STATUS_FILE="$SCRIPT_DIR/tasks/${PROJECT_ID}/agent-status"
  PID_FILE="$SCRIPT_DIR/tasks/${PROJECT_ID}/agent-pid"
  # Ensure per-project directory exists
  mkdir -p "$SCRIPT_DIR/tasks/${PROJECT_ID}"
  LAST_BRANCH_FILE="$SCRIPT_DIR/tasks/${PROJECT_ID}/last-branch"
else
  # 用项目目录的短 hash 隔离 session name，防止不同项目 session 互相冲突
  PROJECT_HASH=$(echo "$PROJECT_DIR" | md5 2>/dev/null | cut -c1-6 || echo "$PROJECT_DIR" | md5sum 2>/dev/null | cut -c1-6 || echo "default")
  SESSION_NAME="botool-teams-${PROJECT_HASH}"
  STATUS_FILE="$SCRIPT_DIR/.state/agent-status"
  PID_FILE="$SCRIPT_DIR/.state/agent-pid"
  LAST_BRANCH_FILE="$SCRIPT_DIR/.state/last-branch"
fi

if [ "$PROJECT_DIR" != "$SCRIPT_DIR" ]; then
  echo ">>> 可移植模式: 项目目录 = $PROJECT_DIR"
  echo ">>> BotoolAgent 目录 = $SCRIPT_DIR"
fi

# ============================================================================
# 加载 .botoolagentrc 配置文件（如果存在）
# ============================================================================
load_config() {
  local config_file="$SCRIPT_DIR/.state/botoolagentrc"
  if [ -f "$config_file" ]; then
    echo ">>> 加载配置文件: $config_file"
    # shellcheck source=/dev/null
    source "$config_file"
  fi
  [ -n "$BOTOOL_TEAMMATE_MODE" ] && BOTOOL_TEAMMATE_MODE="$BOTOOL_TEAMMATE_MODE"
  [ -n "$BOTOOL_MAX_ROUNDS" ] && MAX_ROUNDS="$BOTOOL_MAX_ROUNDS"
  [ -n "$BOTOOL_ROUND_COOLDOWN" ] && ROUND_COOLDOWN="$BOTOOL_ROUND_COOLDOWN"
  [ -n "$BOTOOL_STALL_TIMEOUT" ] && STALL_TIMEOUT="$BOTOOL_STALL_TIMEOUT"
}

# 创建必要目录
mkdir -p "$SCRIPT_DIR/.state"

load_config

# ============================================================================
# 工具函数
# ============================================================================
check_all_tasks_complete() {
  # Count total DT tasks
  local total=$(grep -c '"id": "DT-' "$PRD_FILE" 2>/dev/null | tr -d '[:space:]')
  [ -z "$total" ] && total=0
  # If no tasks exist, not complete
  [ "$total" -eq 0 ] && return 1
  # Count tasks explicitly marked as passed
  local passed=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null | tr -d '[:space:]')
  [ -z "$passed" ] && passed=0
  # All tasks complete only if every task has passes: true
  [ "$passed" -ge "$total" ]
}

update_status() {
  local status="$1"
  local message="$2"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

  local completed=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null | tr -d '[:space:]')
  [ -z "$completed" ] && completed=0
  local total=$(grep -c '"id": "DT-' "$PRD_FILE" 2>/dev/null | tr -d '[:space:]')
  [ -z "$total" ] && total=0
  local current_task=$(grep -o '## [0-9-]* - DT-[0-9]*' "$PROGRESS_FILE" 2>/dev/null | tail -1 | grep -o 'DT-[0-9]*' || echo "none")

  # Sanitize strings for safe JSON embedding (strip ", \, control chars)
  # LC_ALL=C: force byte-by-byte processing to avoid "Illegal byte sequence" with UTF-8/CJK chars on macOS
  local safe_status=$(printf '%s' "$status" | LC_ALL=C tr -d '"\\\n\r')
  local safe_message=$(printf '%s' "$message" | LC_ALL=C tr -d '"\\\n\r')
  local safe_task=$(printf '%s' "$current_task" | LC_ALL=C tr -d '"\\\n\r')

  cat > "$STATUS_FILE" << EOF
{
  "status": "$safe_status",
  "message": "$safe_message",
  "timestamp": "$timestamp",
  "iteration": ${CURRENT_ROUND:-0},
  "maxIterations": $MAX_ROUNDS,
  "completed": $completed,
  "total": $total,
  "currentTask": "$safe_task",
  "retryCount": 0
}
EOF
}

# ============================================================================
# 前置检查
# ============================================================================
echo ">>> BotoolAgent 启动中..."
echo ""

# 1. tmux
command -v tmux &>/dev/null || { echo "ERROR: tmux required (brew install tmux)"; exit 1; }

# 2. claude CLI
CLAUDE_CMD=$(which claude 2>/dev/null || echo "$HOME/.claude/local/claude")
[ -x "$CLAUDE_CMD" ] || { echo "ERROR: claude CLI not found"; exit 1; }

# 3. dev.json (or prd.json fallback) exists
[ -f "$PRD_FILE" ] || { echo "ERROR: dev.json not found at $PRD_FILE"; exit 1; }

echo ">>> 前置检查通过"
echo "    tmux: $(tmux -V)"
echo "    claude: $CLAUDE_CMD"
echo "    项目目录: $PROJECT_DIR"
echo "    dev.json: $PRD_FILE"
echo "    session: $SESSION_NAME"
echo ""

# ============================================================================
# 清理残留进程（防止僵尸 BotoolAgent.sh 进程累积）
# ============================================================================
MY_PID=$$
if [ -n "$PROJECT_ID" ]; then
  # Project-aware 模式：只清理匹配当前 PROJECT_ID 的 BotoolAgent.sh 进程
  # 避免在并发运行多个项目时误杀其他项目的进程
  STALE_PIDS=$(pgrep -f "BotoolAgent\.sh.*--project-id[[:space:]]+${PROJECT_ID}\b" 2>/dev/null | grep -v "^${MY_PID}$" || true)
  if [ -z "$STALE_PIDS" ]; then
    # 备选匹配：通过 prd-path 中的 project-id 目录名匹配
    STALE_PIDS=$(pgrep -f "BotoolAgent\.sh.*/${PROJECT_ID}/" 2>/dev/null | grep -v "^${MY_PID}$" || true)
  fi
  if [ -n "$STALE_PIDS" ]; then
    echo ">>> 检测到项目 ${PROJECT_ID} 的残留 BotoolAgent 进程，正在清理..."
    for pid in $STALE_PIDS; do
      if [ "$pid" != "$MY_PID" ] && [ "$pid" != "$PPID" ]; then
        echo "    终止 PID $pid"
        kill "$pid" 2>/dev/null || true
      fi
    done
    sleep 1
  fi
else
  # 无 PROJECT_ID 时保持原有行为（单项目向后兼容：清理所有残留进程）
  STALE_PIDS=$(pgrep -f "bash.*BotoolAgent\.sh" 2>/dev/null | grep -v "^${MY_PID}$" || true)
  if [ -n "$STALE_PIDS" ]; then
    echo ">>> 检测到残留 BotoolAgent 进程，正在清理..."
    for pid in $STALE_PIDS; do
      # 跳过自身的父进程链
      if [ "$pid" != "$MY_PID" ] && [ "$pid" != "$PPID" ]; then
        echo "    终止 PID $pid"
        kill "$pid" 2>/dev/null || true
      fi
    done
    sleep 1
  fi
fi

# ============================================================================
# 归档检查（分支变更时归档旧运行）
# ============================================================================
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(grep -o '"branchName": "[^"]*"' "$PRD_FILE" 2>/dev/null | sed 's/"branchName": "//;s/"$//' || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    DATE=$(date +%Y-%m-%d)
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^botool-dev/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

    echo ">>> 正在归档上次运行: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "    已归档到: $ARCHIVE_FOLDER"

    echo "# Botool 开发代理进度日志" > "$PROGRESS_FILE"
    echo "开始时间: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi

# 记录当前分支
if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(grep -o '"branchName": "[^"]*"' "$PRD_FILE" 2>/dev/null | sed 's/"branchName": "//;s/"$//' || echo "")
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

# 初始化进度文件
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Botool 开发代理进度日志" > "$PROGRESS_FILE"
  echo "开始时间: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

# ============================================================================
# 写入初始 .agent-status
# ============================================================================
update_status "starting" "BotoolAgent 启动中"

# 写入 PID 文件（JSON 格式，与 agent/status API 期望的 AgentPidInfo 结构一致）
printf '{"pid":%d,"startedAt":"%s"}\n' $$ "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PID_FILE"

# ============================================================================
# start_session(): 创建 tmux session，发送 prompt，等待结束
# ============================================================================
start_session() {
  # 清理可能残留的 session
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo ">>> 清理残留 session..."
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null
    sleep 2
  fi

  # -----------------------------------------------------------------------
  # Worktree 自动创建/复用逻辑（仅当 PROJECT_ID 非空时启用）
  # -----------------------------------------------------------------------

  # 检测 main 分支名称（兼容 main/master）
  if git -C "$PROJECT_DIR" rev-parse --verify main >/dev/null 2>&1; then
    MAIN_BRANCH="main"
  elif git -C "$PROJECT_DIR" rev-parse --verify master >/dev/null 2>&1; then
    MAIN_BRANCH="master"
  else
    MAIN_BRANCH="HEAD"
  fi

  if [ -n "$PROJECT_ID" ]; then
    WORKTREE_PATH="$PROJECT_DIR/.worktrees/${PROJECT_ID}"
    WORKTREE_BRANCH="botool/${PROJECT_ID}"

    if [ -d "$WORKTREE_PATH" ]; then
      # Worktree 已存在：复用，并确认分支一致
      echo ">>> Worktree 已存在，复用: $WORKTREE_PATH"
      EXISTING_BRANCH=$(git -C "$WORKTREE_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
      if [ "$EXISTING_BRANCH" != "$WORKTREE_BRANCH" ]; then
        echo ">>> 警告: worktree 分支 ($EXISTING_BRANCH) 与预期分支 ($WORKTREE_BRANCH) 不一致"
        echo ">>>        继续使用当前分支: $EXISTING_BRANCH"
      else
        echo ">>> Worktree 分支确认: $WORKTREE_BRANCH"
      fi
    else
      # Worktree 不存在：创建新 worktree
      echo ">>> 创建 worktree: $WORKTREE_PATH (分支: $WORKTREE_BRANCH)"
      mkdir -p "$PROJECT_DIR/.worktrees"
      if git -C "$PROJECT_DIR" worktree add "$WORKTREE_PATH" -b "$WORKTREE_BRANCH" "$MAIN_BRANCH" 2>/dev/null; then
        echo ">>> Worktree 创建成功"
      else
        # 分支可能已存在（上次运行后被 prune 了 worktree 但分支保留）
        echo ">>> 分支已存在，尝试 checkout..."
        if git -C "$PROJECT_DIR" worktree add "$WORKTREE_PATH" "$WORKTREE_BRANCH" 2>/dev/null; then
          # 已有分支可能不在 main 上，但保持其现有历史
          echo ">>> Worktree 复用已有分支成功"
        else
          echo ">>> 错误: worktree 创建失败，拒绝在主仓库中运行"
          echo ">>> 可能原因: 分支 $WORKTREE_BRANCH 已在主仓库中 checkout"
          echo ">>> 修复方法: git checkout main && git branch -D $WORKTREE_BRANCH"
          update_status "error" "Worktree 创建失败，拒绝 fallback 到主仓库"
          exit 1
        fi
      fi
    fi

    WORK_DIR="$WORKTREE_PATH"

    # 安全验证：确保 WORK_DIR 确实是 worktree，而非主仓库
    if [ "$WORK_DIR" = "$PROJECT_DIR" ]; then
      echo ">>> 错误: WORK_DIR 等于 PROJECT_DIR，worktree 未正确创建"
      update_status "error" "Worktree 安全检查失败"
      exit 1
    fi

    # Worktree 依赖 symlink（node_modules 不在 git 中，需手动链接）
    if [ "$WORK_DIR" != "$PROJECT_DIR" ]; then
      for nm_dir in "node_modules" "viewer/node_modules"; do
        SRC="$PROJECT_DIR/$nm_dir"
        DST="$WORK_DIR/$nm_dir"
        if [ -d "$SRC" ] && [ ! -e "$DST" ]; then
          ln -s "$SRC" "$DST"
          echo ">>> Symlinked $nm_dir → worktree"
        fi
      done
    fi
  else
    # 无 PROJECT_ID：保持原有行为
    WORK_DIR="$PROJECT_DIR"
  fi

  echo ">>> 工作目录: $WORK_DIR"

  # 构建环境变量并创建 tmux session
  TMUX_ENV="CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1"
  TMUX_ENV="$TMUX_ENV BOTOOL_SCRIPT_DIR=$SCRIPT_DIR"
  TMUX_ENV="$TMUX_ENV BOTOOL_PROJECT_DIR=$WORK_DIR"
  TMUX_ENV="$TMUX_ENV BOTOOL_MAX_ROUNDS=$MAX_ROUNDS"
  TMUX_ENV="$TMUX_ENV BOTOOL_PRD_FILE=$PRD_FILE"
  TMUX_ENV="$TMUX_ENV BOTOOL_PROGRESS_FILE=$PROGRESS_FILE"
  TMUX_ENV="$TMUX_ENV BOTOOL_STATUS_FILE=$STATUS_FILE"

  # 每次生成新 session-id，防止 Claude CLI 自动恢复旧会话
  # （旧会话上下文会导致 Lead Agent 卡在之前项目的文件中）
  CLAUDE_SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

  tmux new-session -d -s "$SESSION_NAME" -c "$WORK_DIR" \
    "env -u CLAUDECODE $TMUX_ENV $CLAUDE_CMD --session-id $CLAUDE_SESSION_ID --dangerously-skip-permissions --model $BOTOOL_MODEL --teammate-mode $BOTOOL_TEAMMATE_MODE"

  # 验证 session 是否成功启动
  sleep 2
  if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "ERROR: tmux session 启动失败！Claude CLI 可能无法启动。"
    echo "       请检查是否有 CLAUDECODE 环境变量冲突。"
    return 1
  fi

  # 等待 Claude CLI 启动并显示确认对话框
  echo ">>> 等待权限确认对话框..."
  sleep 3

  # 处理 --dangerously-skip-permissions 确认对话框
  # Claude CLI 显示 Ink-based 菜单，需选择 "Yes, I accept"（第 2 项）
  tmux send-keys -t "$SESSION_NAME" Down
  sleep 1
  tmux send-keys -t "$SESSION_NAME" Enter

  # 等待 Claude CLI 完全就绪（Welcome 屏幕 + 输入框加载）
  echo ">>> 等待 Claude CLI 就绪..."
  sleep 8

  # 验证 tmux pane 的工作目录是否正确
  PANE_CWD=$(tmux display-message -t "$SESSION_NAME" -p '#{pane_current_path}' 2>/dev/null || echo "")
  if [ -n "$PANE_CWD" ] && [ "$PANE_CWD" != "$WORK_DIR" ]; then
    echo ">>> 警告: tmux pane CWD ($PANE_CWD) != 预期目录 ($WORK_DIR)"
    echo ">>> 这可能导致 Agent 在错误的项目中工作！"
    echo ">>> 尝试修正..."
  fi

  # 发送初始 prompt（读取 Lead Agent 指令）
  tmux send-keys -t "$SESSION_NAME" C-u
  sleep 0.5
  INITIAL_PROMPT="读取 $SCRIPT_DIR/CLAUDE.lead.md 的全部内容，按照其中的指令执行。"
  tmux send-keys -t "$SESSION_NAME" "$INITIAL_PROMPT"
  sleep 1
  tmux send-keys -t "$SESSION_NAME" Enter

  echo ">>> BotoolAgent session started: $SESSION_NAME"
  echo ""
  echo "    查看进度:  tmux attach -t $SESSION_NAME"
  echo "    查看状态:  cat $STATUS_FILE"
  echo "    停止运行:  Ctrl+C  或  tmux kill-session -t $SESSION_NAME"
  echo ""

  # 等待 tmux session 结束（含卡住检测）
  local last_commit_hash=$(git -C "$WORK_DIR" rev-parse HEAD 2>/dev/null || echo "")
  local last_progress_time=$(date +%s)

  while tmux has-session -t "$SESSION_NAME" 2>/dev/null; do
    sleep 30

    # Context limit 主动检测（秒级响应，替代 15 分钟超时等待）
    pane_content=$(tmux capture-pane -t "$SESSION_NAME" -p -l 30 2>/dev/null || echo "")
    if echo "$pane_content" | grep -qE "Context limit reached|context is full|0% remaining"; then
      echo ">>> [RALPH] 检测到 context limit，终止当前 session，准备下一轮..."
      tmux kill-session -t "$SESSION_NAME" 2>/dev/null
      sleep 2
      break
    fi

    # 检查 agent-status 是否已标记 session 结束
    local agent_status=$(grep -o '"status": "[^"]*"' "$STATUS_FILE" 2>/dev/null | head -1 | sed 's/"status": "//;s/"$//')
    if [ "$agent_status" = "session_done" ] || [ "$agent_status" = "complete" ]; then
      echo ">>> Lead Agent 已完成本 session（status: $agent_status）"
      echo ">>> 终止 Claude CLI session..."
      tmux kill-session -t "$SESSION_NAME" 2>/dev/null
      sleep 2
      break
    fi

    # 检查是否有新 commit（监控 worktree 目录）
    local current_commit_hash=$(git -C "$WORK_DIR" rev-parse HEAD 2>/dev/null || echo "")
    if [ "$current_commit_hash" != "$last_commit_hash" ]; then
      last_commit_hash="$current_commit_hash"
      last_progress_time=$(date +%s)
    fi

    # 卡住检测：超过 STALL_TIMEOUT 秒无新 commit
    local now=$(date +%s)
    local elapsed=$(( now - last_progress_time ))
    if [ "$elapsed" -ge "$STALL_TIMEOUT" ]; then
      echo ">>> 检测到卡住：${elapsed}秒无新 commit（超时 ${STALL_TIMEOUT}秒）"
      echo ">>> 终止 session，准备下一轮..."
      tmux kill-session -t "$SESSION_NAME" 2>/dev/null
      sleep 2
      break
    fi
  done
}

# ============================================================================
# Ralph 外循环: 自动重启 session 直到所有任务完成
# ============================================================================
CURRENT_ROUND=0
FINAL_STATUS_SET=false

for CURRENT_ROUND in $(seq 1 $MAX_ROUNDS); do
  # 1. 检查是否还有未完成任务
  if check_all_tasks_complete; then
    echo ">>> 所有任务已完成！"
    break
  fi

  # 2. 进度信息
  completed=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null | tr -d '[:space:]')
  [ -z "$completed" ] && completed=0
  total=$(grep -c '"id": "DT-' "$PRD_FILE" 2>/dev/null | tr -d '[:space:]')
  [ -z "$total" ] && total=0

  echo ""
  echo "==============================================================="
  echo "  BotoolAgent - 轮次 $CURRENT_ROUND/$MAX_ROUNDS (已完成 $completed/$total)"
  echo "==============================================================="

  # 3. 更新状态
  update_status "running" "BotoolAgent 轮次 $CURRENT_ROUND/$MAX_ROUNDS"

  # 4. 启动 session 并等待结束
  start_session

  # 5. Session 结束后检查
  if check_all_tasks_complete; then
    echo ">>> 全部完成！"
    break
  fi

  # 6. 没完成，准备下一轮
  echo ">>> Session 结束但还有未完成任务，${ROUND_COOLDOWN}秒后启动下一轮..."
  sleep $ROUND_COOLDOWN
done

# ============================================================================
# 最终状态
# ============================================================================
if [ "$FINAL_STATUS_SET" = "false" ]; then
  if check_all_tasks_complete; then
    update_status "complete" "所有任务已完成（轮次 $CURRENT_ROUND/$MAX_ROUNDS）"
    echo ">>> BotoolAgent 已完成所有任务"
  else
    update_status "max_rounds" "达到最大轮次 $MAX_ROUNDS，仍有未完成任务"
    echo ">>> 达到最大轮次限制。请查看 progress.txt 了解状态。"
  fi
fi
