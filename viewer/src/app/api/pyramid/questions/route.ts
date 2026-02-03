import { NextRequest } from 'next/server';
import { parseSkillPrompts, fillPromptTemplate } from '@/lib/skill-parser';
import { getActiveDimensions, type LevelId } from '@/lib/dimension-framework';

interface QuestionRequest {
  level: LevelId;
  collectedAnswers: Record<string, string | string[]>;
  activeDimensions?: string[];
  requirementType: string;
  initialDescription: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: QuestionRequest = await request.json();
    const { level, collectedAnswers, activeDimensions, requirementType, initialDescription } = body;

    if (!level || level < 1 || level > 4) {
      return new Response(JSON.stringify({ error: 'Invalid level' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get prompts from skill
    const prompts = await parseSkillPrompts();

    // Select prompt based on level
    const promptKey = `L${level}_QUESTION_PROMPT` as keyof typeof prompts;
    const template = prompts[promptKey];

    if (!template) {
      return new Response(JSON.stringify({ error: 'Prompt not found' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Determine active dimensions for L2+
    let dimensions = activeDimensions || [];
    if (level === 2 && dimensions.length === 0) {
      dimensions = getActiveDimensions(collectedAnswers, initialDescription);
    }

    // Fill template variables
    const filledPrompt = fillPromptTemplate(template, {
      description: initialDescription,
      requirementType,
      l1Answers: JSON.stringify(collectedAnswers),
      collectedAnswers: JSON.stringify(collectedAnswers),
      activeDimensions: dimensions.join(', '),
    });

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Return mock questions for development
      return new Response(JSON.stringify({
        questions: getMockQuestions(level),
        suggestedDimensions: dimensions,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Call Anthropic API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: filledPrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('Anthropic API error:', await response.text());
      return new Response(JSON.stringify({
        questions: getMockQuestions(level),
        suggestedDimensions: dimensions,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const textBlock = data.content?.find((block: { type: string }) => block.type === 'text');
    const responseText = textBlock?.text || '';

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return new Response(JSON.stringify({
        questions: parsed.questions || [],
        suggestedDimensions: parsed.suggestedDimensions || dimensions,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fallback to mock questions
    return new Response(JSON.stringify({
      questions: getMockQuestions(level),
      suggestedDimensions: dimensions,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Question generation error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Mock questions for development/fallback
function getMockQuestions(level: LevelId) {
  const mockQuestions: Record<LevelId, object[]> = {
    1: [
      {
        id: 'l1-q1',
        text: '这个功能主要面向哪类用户？',
        type: 'single',
        options: [
          { value: 'developer', label: '开发者' },
          { value: 'business', label: '业务人员' },
          { value: 'end-user', label: '最终用户' },
          { value: 'admin', label: '管理员' },
        ],
        required: true,
        topic: 'target-user',
      },
      {
        id: 'l1-q2',
        text: '这个功能要解决的核心问题是什么？',
        type: 'text',
        required: true,
        topic: 'core-problem',
      },
      {
        id: 'l1-q3',
        text: '功能上线后，如何判断是否成功？',
        type: 'text',
        required: true,
        topic: 'success-criteria',
      },
      {
        id: 'l1-q4',
        text: '这个需求的紧急程度如何？',
        type: 'single',
        options: [
          { value: 'urgent', label: '非常紧急（本周）' },
          { value: 'high', label: '较高（两周内）' },
          { value: 'medium', label: '中等（一个月内）' },
          { value: 'low', label: '较低（可排期）' },
        ],
        required: true,
        topic: 'urgency',
      },
    ],
    2: [
      {
        id: 'l2-q1',
        text: '界面需要支持哪些交互方式？',
        type: 'multiple',
        options: [
          { value: 'click', label: '点击' },
          { value: 'drag', label: '拖拽' },
          { value: 'keyboard', label: '键盘快捷键' },
          { value: 'touch', label: '触摸手势' },
        ],
        required: true,
        dimension: 'frontend',
        topic: 'interaction',
      },
      {
        id: 'l2-q2',
        text: '需要存储哪些类型的数据？',
        type: 'multiple',
        options: [
          { value: 'user-data', label: '用户数据' },
          { value: 'config', label: '配置信息' },
          { value: 'history', label: '历史记录' },
          { value: 'files', label: '文件/媒体' },
        ],
        required: true,
        dimension: 'backend',
        topic: 'data-model',
      },
    ],
    3: [
      {
        id: 'l3-q1',
        text: '请描述用户完成核心操作的具体步骤',
        type: 'text',
        required: true,
        dimension: 'ux',
        topic: 'user-flow',
      },
      {
        id: 'l3-q2',
        text: '当操作失败时，应该如何提示用户？',
        type: 'text',
        required: true,
        dimension: 'ux',
        topic: 'error-handling',
      },
    ],
    4: [
      {
        id: 'l4-q1',
        text: '以下哪些功能明确不在本次需求范围内？',
        type: 'multiple',
        options: [
          { value: 'multi-lang', label: '多语言支持' },
          { value: 'offline', label: '离线模式' },
          { value: 'export', label: '数据导出' },
          { value: 'notification', label: '通知推送' },
        ],
        required: false,
        topic: 'out-scope',
      },
      {
        id: 'l4-q2',
        text: '功能验收的具体标准是什么？',
        type: 'text',
        required: true,
        topic: 'acceptance-criteria',
      },
    ],
  };

  return mockQuestions[level] || [];
}
