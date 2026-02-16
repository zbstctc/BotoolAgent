# API 设计规范

## 路由结构（Next.js App Router）
- 路由文件固定为 `route.ts`，放在 `src/app/api/{feature}/` 下
- 嵌套资源使用子目录：`/api/prd/[id]/route.ts`、`/api/prd/save/route.ts`
- 动态参数使用 `[param]` 目录名

## HTTP 方法
- `GET`：查询/列表
- `POST`：创建/执行操作
- `DELETE`：删除资源
- 导出格式：`export async function GET(request: NextRequest) { ... }`

## 请求解析
- JSON body：`const body = await request.json()`
- Query params：`const searchParams = request.nextUrl.searchParams; searchParams.get('key')`
- 路径参数：`{ params }: { params: Promise<{ id: string }> }` 然后 `const { id } = await params`

## 响应格式
- 成功：`NextResponse.json({ data })` 或 `NextResponse.json({ success: true, ... })`
- 错误：`NextResponse.json({ error: '描述' }, { status: 4xx/5xx })`
- 流式：`new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })`

## 状态码
- `200`：成功（`NextResponse.json()` 默认）
- `201`：创建成功
- `400`：参数错误（缺失必填字段、格式不合法）
- `404`：资源不存在
- `409`：冲突（如 Agent 已在运行）
- `500`：服务器错误

## 错误处理
- 每个 handler 用 try/catch 包裹
- `catch` 中记录 `console.error()`，返回通用错误消息
- 禁止在错误响应中暴露内部路径或堆栈信息
- 输入校验在 handler 顶部完成，不合法立即 return 400

## SSE 流式响应模式
```typescript
const encoder = new TextEncoder();
let controller: ReadableStreamDefaultController | null = null;

const stream = new ReadableStream({
  start(c) { controller = c; },
  cancel() { /* cleanup */ }
});

// 发送数据
controller?.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
// 结束
controller?.close();

return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  },
});
```

## 子进程 spawn 规范
- 必须移除 `CLAUDECODE` 环境变量防止嵌套 session 错误
  ```typescript
  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  ```
- 长时间运行的进程使用 `detached: true` + `child.unref()`
- PID 写入 `.state/agent-pid` 文件用于进程管理

## 文件系统操作
- 使用 `@/lib/project-root` 中的路径函数获取绝对路径
- 检查文件存在用 `fs.existsSync()`，读取用 `fs.readFileSync(path, 'utf-8')`
- 写入文件前确保目录存在（`mkdir -p`）
